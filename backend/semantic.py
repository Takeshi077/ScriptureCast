import os
import json
import re
import sqlite3
import threading

try:
    import numpy as np
    import sklearn
    _HAS_DEPS = True
except ImportError:
    _HAS_DEPS = False

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "bible.db")
CACHE_DIR = os.path.join(BASE_DIR, "data", "embeddings")
VECTORIZER_FILE = os.path.join(CACHE_DIR, "tfidf_vectorizer.joblib")
MATRIX_FILE = os.path.join(CACHE_DIR, "tfidf_matrix.npz")
VERSE_INFO_FILE = os.path.join(CACHE_DIR, "verse_info.json")

_vectorizer = None
_tfidf_matrix = None
_verse_info = None
_embeddings_lock = threading.Lock()

_semantic_model = None
_favorite_verses = set()

QUOTE_INDICATORS = [
    "the scripture says", "the bible says", "the word of god", "it is written",
    "as it is written", "for it is written", "for the scripture", "as the scripture",
    "the lord says", "thus says", "says the lord", "declares the lord",
    "the apostle", "jesus said", "the lord said", "he said unto",
    "i say unto you", "verily i say", "blessed are", "woe unto",
    "the word says", "the word of the lord", "according to the scriptures",
    "the spirit says", "the prophet", "king david", "the psalmist",
    "moses said", "paul said", "peter said", "john said",
    "as we read in", "we read in", "remember when",
    "jesus answered", "he replied", "he answered",
    "love your neighbor", "love thy neighbor", "love the lord",
    "fear not", "do not be afraid", "be not afraid",
    "do not fear", "the lord is my", "the lord bless",
    "in the beginning", "for god so loved", "go therefore",
]


def _clean_text(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _load_verse_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT translation, book, chapter, verse, text FROM scriptures ORDER BY translation, id"
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {"translation": t, "book": b, "chapter": c, "verse": v, "text": txt}
        for t, b, c, v, txt in rows
    ]


def _build_index():
    from sklearn.feature_extraction.text import TfidfVectorizer
    from joblib import dump
    os.makedirs(CACHE_DIR, exist_ok=True)
    verses = _load_verse_data()
    texts = [_clean_text(v["text"]) for v in verses]
    print("  Building TF-IDF search index (~30 seconds)...")
    vectorizer = TfidfVectorizer(
        max_features=50000, ngram_range=(1, 3),
        stop_words="english", sublinear_tf=True,
    )
    matrix = vectorizer.fit_transform(texts)
    print(f"  TF-IDF done: {matrix.shape[0]} verses, {matrix.shape[1]} terms")
    dump(vectorizer, VECTORIZER_FILE)
    from scipy.sparse import save_npz
    save_npz(MATRIX_FILE, matrix)
    with open(VERSE_INFO_FILE, "w", encoding="utf-8") as f:
        json.dump(verses, f, ensure_ascii=False)
    print(f"  Cached to {CACHE_DIR}")
    return vectorizer, matrix, verses


def _load_index():
    from scipy.sparse import load_npz
    from joblib import load as jload
    vectorizer = jload(VECTORIZER_FILE)
    matrix = load_npz(MATRIX_FILE)
    with open(VERSE_INFO_FILE, "r", encoding="utf-8") as f:
        verses = json.load(f)
    return vectorizer, matrix, verses


def ensure_embeddings():
    if not _HAS_DEPS:
        print("  Semantic search disabled (numpy/scikit-learn not available)")
        return False
    global _vectorizer, _tfidf_matrix, _verse_info
    if _vectorizer is not None and _tfidf_matrix is not None:
        return True
    with _embeddings_lock:
        if _vectorizer is not None and _tfidf_matrix is not None:
            return True
        if os.path.exists(MATRIX_FILE) and os.path.exists(VERSE_INFO_FILE):
            try:
                _vectorizer, _tfidf_matrix, _verse_info = _load_index()
                print(f"  Loaded cached TF-IDF index ({_tfidf_matrix.shape[0]} verses)")
            except Exception as e:
                print(f"  Cache load failed: {e}, rebuilding...")
                _vectorizer, _tfidf_matrix, _verse_info = _build_index()
        else:
            _vectorizer, _tfidf_matrix, _verse_info = _build_index()
        _get_semantic_model()
    return True


def _get_semantic_model():
    global _semantic_model
    if _semantic_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            print("  Loading semantic re-ranker model...")
            _semantic_model = SentenceTransformer("all-MiniLM-L6-v2", local_files_only=True)
        except Exception as e:
            print(f"  Semantic model unavailable (re-ranking disabled): {e}")
    return _semantic_model


def _rerank_with_semantic(query_text, candidates, top_k):
    import numpy as np
    if not candidates:
        return []
    model = _get_semantic_model()
    if model is None:
        return candidates[:top_k]
    verse_texts = [c["text"] for c in candidates]
    query_emb = model.encode([_clean_text(query_text)], show_progress_bar=False)[0]
    verse_embs = model.encode(verse_texts, show_progress_bar=False)
    sims = np.dot(verse_embs, query_emb) / (
        np.linalg.norm(verse_embs, axis=1) * np.linalg.norm(query_emb) + 1e-8
    )
    scored = [(i, float(sim)) for i, sim in enumerate(sims)]
    scored.sort(key=lambda x: x[1], reverse=True)
    reranked = []
    for i, sim in scored[:top_k]:
        c = dict(candidates[i])
        semantic_conf = max(0, min(100, int((sim - 0.2) / 0.8 * 100)))
        c["confidence"] = max(c["confidence"], semantic_conf)
        c["type"] = "semantic"
        reranked.append(c)
    return reranked


def might_be_quote(text):
    text_lower = text.lower().strip()
    if len(text_lower) < 10:
        return False
    for indicator in QUOTE_INDICATORS:
        if indicator in text_lower:
            return True
    return False


def search_similar_verses(query_text, translation=None, context_book=None, context_chapter=None, top_k=5):
    if not _HAS_DEPS:
        return []
    import numpy as np
    global _vectorizer, _tfidf_matrix, _verse_info
    if _vectorizer is None or _tfidf_matrix is None:
        ensure_embeddings()

    cleaned = _clean_text(query_text)
    if not cleaned:
        return []

    query_vec = _vectorizer.transform([cleaned])
    similarities = (_tfidf_matrix @ query_vec.T).toarray().flatten()

    if translation:
        mask = np.array([v["translation"] == translation for v in _verse_info])
        similarities[~mask] = -1

    top_n = min(top_k * 10, len(similarities))
    top_indices = np.argsort(similarities)[-top_n:][::-1]

    candidates = []
    seen_refs = set()
    for idx in top_indices:
        sim = float(similarities[idx])
        if sim < 0.05:
            continue
        verse = _verse_info[idx]
        ref_key = f"{verse['book']}|{verse['chapter']}|{verse['verse']}|{verse['translation']}"
        if ref_key in seen_refs:
            continue
        seen_refs.add(ref_key)

        confidence = max(0, min(100, int((sim - 0.05) / 0.4 * 100)))
        if context_book and verse["book"].lower() == context_book.lower():
            if context_chapter and verse["chapter"] == context_chapter:
                confidence = min(100, confidence + 25)
            else:
                confidence = min(100, confidence + 15)
        fav_ref = f"{verse['book']} {verse['chapter']}:{verse['verse']}"
        if fav_ref in _favorite_verses:
            confidence = min(100, confidence + 10)

        candidates.append({
            "raw_match": query_text,
            "book": verse["book"],
            "chapter": verse["chapter"],
            "verse_start": verse["verse"],
            "verse_end": None,
            "translation": verse["translation"],
            "text": verse["text"],
            "confidence": confidence,
            "type": "semantic",
        })

    candidates.sort(key=lambda r: r["confidence"], reverse=True)
    candidates = candidates[:top_k * 3]

    try:
        candidates = _rerank_with_semantic(query_text, candidates, top_k)
    except Exception as e:
        print(f"  Re-ranking failed: {e}")

    return candidates[:top_k]


def set_favorite_verse(book, chapter, verse, favorite=True):
    ref = f"{book} {chapter}:{verse}"
    if favorite:
        _favorite_verses.add(ref)
    else:
        _favorite_verses.discard(ref)


def is_favorite_verse(book, chapter, verse):
    ref = f"{book} {chapter}:{verse}"
    return ref in _favorite_verses
