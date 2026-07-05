import sqlite3
import os
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "bible.db")

# Thread-local persistent connection — avoids opening/closing SQLite on every lookup.
_local = threading.local()

def _get_conn():
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    return _local.conn

def get_scripture(translation, book, chapter, verse_start=None, verse_end=None):
    """
    Queries the SQLite database for a scripture reference.
    Returns a dictionary containing:
      - 'reference': clean formatted reference string (e.g. "John 3:16-18 (WEB)")
      - 'verses': list of dicts with 'verse' (num) and 'text'
      - 'combined_text': concatenated text of the verses
    """
    if not os.path.exists(DB_PATH):
        return {"error": "Database not found."}

    conn = _get_conn()
    cursor = conn.cursor()

    # Defaults to verse 1 if no verse is specified (VD-03)
    if verse_start is None:
        verse_start = 1
        verse_end = None
        reference_str = f"{book} {chapter} (verse 1 defaults)"
    else:
        if verse_end:
            reference_str = f"{book} {chapter}:{verse_start}-{verse_end}"
        else:
            reference_str = f"{book} {chapter}:{verse_start}"

    reference_str += f" ({translation})"

    query = """
        SELECT verse, text
        FROM scriptures
        WHERE translation = ? AND book = ? AND chapter = ?
    """
    params = [translation, book, chapter]

    if verse_end:
        query += " AND verse >= ? AND verse <= ?"
        params.extend([verse_start, verse_end])
    else:
        query += " AND verse = ?"
        params.append(verse_start)

    query += " ORDER BY verse ASC"

    cursor.execute(query, params)
    rows = cursor.fetchall()

    if not rows:
        return {
            "reference": reference_str,
            "verses": [],
            "combined_text": "Scripture reference not found in translation."
        }

    verses = []
    text_parts = []
    for verse_num, text in rows:
        verses.append({
            "verse": verse_num,
            "text": text
        })
        text_parts.append(text)

    combined_text = " ".join(text_parts)

    return {
        "reference": reference_str,
        "verses": verses,
        "combined_text": combined_text
    }

if __name__ == "__main__":
    # Test queries
    print(get_scripture("WEB", "John", 3, 16))
    print(get_scripture("KJV", "Genesis", 1, 1, 3))
    print(get_scripture("WEB", "Romans", 8))  # Chapter only
