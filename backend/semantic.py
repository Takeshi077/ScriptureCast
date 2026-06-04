import os
import json
import sqlite3
import numpy as np
from sentence_transformers import SentenceTransformer

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "bible.db")
EMBEDDINGS_DIR = os.path.join(BASE_DIR, "data", "embeddings")
EMBEDDINGS_FILE = os.path.join(EMBEDDINGS_DIR, "verse_embeddings.npy")
VERSE_INFO_FILE = os.path.join(EMBEDDINGS_DIR, "verse_info.json")

_model = None
_embeddings = None
_verse_info = None
_favorite_verses = set()

MODEL_NAME = "all-MiniLM-L6-v2"

# Phrases that strongly suggest a Bible quote is being spoken
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


def _get_model():
    global _model
    if _model is None:
        print("  Loading semantic search model...")
        _model = SentenceTransformer(MODEL_NAME)
    return _model


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


def _compute_and_cache_embeddings(verses):
    os.makedirs(EMBEDDINGS_DIR, exist_ok=True)
    model = _get_model()
    texts = [v["text"] for v in verses]
    print(f"  Computing embeddings for {len(texts)} verses (first run, may take a minute)...")
    embeddings = model.encode(texts, show_progress_bar=True, batch_size=64)
    np.save(EMBEDDINGS_FILE, embeddings)
    with open(VERSE_INFO_FILE, "w", encoding="utf-8") as f:
        json.dump(verses, f, ensure_ascii=False)
    print(f"  Cached {len(embeddings)} verse embeddings to disk")
    return embeddings, verses


def _load_cached_embeddings():
    embeddings = np.load(EMBEDDINGS_FILE)
    with open(VERSE_INFO_FILE, "r", encoding="utf-8") as f:
        verses = json.load(f)
    return embeddings, verses


def ensure_embeddings():
    global _embeddings, _verse_info
    if _embeddings is not None and _verse_info is not None:
        return True
    if os.path.exists(EMBEDDINGS_FILE) and os.path.exists(VERSE_INFO_FILE):
        try:
            _embeddings, _verse_info = _load_cached_embeddings()
            print(f"  Loaded {len(_embeddings)} cached verse embeddings")
            return True
        except Exception as e:
            print(f"  Cache load failed: {e}, recomputing...")
    verses = _load_verse_data()
    _embeddings, _verse_info = _compute_and_cache_embeddings(verses)
    return True


def embed_text(text):
    model = _get_model()
    return model.encode([text], show_progress_bar=False)[0]


def might_be_quote(text):
    text_lower = text.lower().strip()
    if len(text_lower) < 10:
        return False
    for indicator in QUOTE_INDICATORS:
        if indicator in text_lower:
            return True
    return False


def search_similar_verses(query_text, translation=None, context_book=None, context_chapter=None, top_k=5):
    global _embeddings, _verse_info
    if _embeddings is None or _verse_info is None:
        ensure_embeddings()

    query_emb = embed_text(query_text)
    norms = np.linalg.norm(_embeddings, axis=1)
    query_norm = np.linalg.norm(query_emb)
    if query_norm == 0:
        return []
    similarities = np.dot(_embeddings, query_emb) / (norms * query_norm)

    if translation:
        mask = np.array([v["translation"] == translation for v in _verse_info])
        similarities[~mask] = -1

    top_indices = np.argsort(similarities)[-top_k * 3:][::-1]

    results = []
    seen_refs = set()
    for idx in top_indices:
        if len(results) >= top_k:
            break
        sim = float(similarities[idx])
        if sim < 0.3:
            continue
        verse = _verse_info[idx]
        ref_key = f"{verse['book']}|{verse['chapter']}|{verse['verse']}|{verse['translation']}"
        if ref_key in seen_refs:
            continue
        seen_refs.add(ref_key)

        confidence = max(0, min(100, int((sim - 0.3) / 0.7 * 100)))

        if context_book and verse["book"].lower() == context_book.lower():
            if context_chapter and verse["chapter"] == context_chapter:
                confidence = min(100, confidence + 25)
            else:
                confidence = min(100, confidence + 15)

        fav_ref = f"{verse['book']} {verse['chapter']}:{verse['verse']}"
        if fav_ref in _favorite_verses:
            confidence = min(100, confidence + 10)

        results.append({
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

    results.sort(key=lambda r: r["confidence"], reverse=True)
    return results


def set_favorite_verse(book, chapter, verse, favorite=True):
    ref = f"{book} {chapter}:{verse}"
    if favorite:
        _favorite_verses.add(ref)
    else:
        _favorite_verses.discard(ref)


def is_favorite_verse(book, chapter, verse):
    ref = f"{book} {chapter}:{verse}"
    return ref in _favorite_verses
