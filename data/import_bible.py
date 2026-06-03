import urllib.request
import json
import zipfile
import io
import sqlite3
import os

DB_DIR = "c:\\Users\\user\\Desktop\\ScriptureCast\\data"
DB_PATH = os.path.join(DB_DIR, "bible.db")

# 3-letter WEB abbreviation to standard English full name mapping
BOOK_MAP = {
    "GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers", "DEU": "Deuteronomy",
    "JOS": "Joshua", "JDG": "Judges", "RUT": "Ruth", "1SA": "1 Samuel", "2SA": "2 Samuel",
    "1KI": "1 Kings", "2KI": "2 Kings", "1CH": "1 Chronicles", "2CH": "2 Chronicles",
    "EZR": "Ezra", "NEH": "Nehemiah", "EST": "Esther", "JOB": "Job", "PSA": "Psalms",
    "PRO": "Proverbs", "ECC": "Ecclesiastes", "SOL": "Song of Solomon", "ISA": "Isaiah",
    "JER": "Jeremiah", "LAM": "Lamentations", "EZE": "Ezekiel", "DAN": "Daniel",
    "HOS": "Hosea", "JOE": "Joel", "AMO": "Amos", "OBA": "Obadiah", "JON": "Jonah",
    "MIC": "Micah", "NAH": "Nahum", "HAB": "Habakkuk", "ZEP": "Zephaniah", "HAG": "Haggai",
    "ZEC": "Zechariah", "MAL": "Malachi",
    "MAT": "Matthew", "MAR": "Mark", "LUK": "Luke", "JOH": "John", "ACT": "Acts",
    "ROM": "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians", "GAL": "Galatians",
    "EPH": "Ephesians", "PHI": "Philippians", "COL": "Colossians", "1TH": "1 Thessalonians",
    "2TH": "2 Thessalonians", "1TI": "1 Timothy", "2TI": "2 Timothy", "TIT": "Titus",
    "PHM": "Philemon", "HEB": "Hebrews", "JAM": "James", "1PE": "1 Peter", "2PE": "2 Peter",
    "1JO": "1 John", "2JO": "2 John", "3JO": "3 John", "JUD": "Jude", "REV": "Revelation"
}

def setup_db():
    if not os.path.exists(DB_DIR):
        os.makedirs(DB_DIR)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute("DROP TABLE IF EXISTS scriptures")
    cursor.execute("""
        CREATE TABLE scriptures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            translation TEXT,
            book TEXT,
            chapter INTEGER,
            verse INTEGER,
            text TEXT
        )
    """)
    cursor.execute("CREATE INDEX idx_lookup ON scriptures (translation, book, chapter, verse)")
    conn.commit()
    conn.close()

def import_kjv():
    print("Fetching and importing KJV...")
    url_kjv = "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json"
    with urllib.request.urlopen(url_kjv) as response:
        content = response.read().decode('utf-8-sig')
        data = json.loads(content)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    count = 0
    for book_data in data:
        book_name = book_data['name']
        for c_idx, chapter in enumerate(book_data['chapters']):
            chapter_num = c_idx + 1
            for v_idx, verse_text in enumerate(chapter):
                verse_num = v_idx + 1
                cursor.execute(
                    "INSERT INTO scriptures (translation, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)",
                    ("KJV", book_name, chapter_num, verse_num, verse_text)
                )
                count += 1
    
    conn.commit()
    conn.close()
    print(f"KJV Imported: {count} verses.")

def import_web():
    print("Fetching and importing WEB...")
    url_web_vpl = "https://ebible.org/Scriptures/eng-web_vpl.zip"
    req = urllib.request.Request(url_web_vpl, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        zip_data = response.read()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    count = 0
    with zipfile.ZipFile(io.BytesIO(zip_data)) as z:
        txt_file = [f for f in z.namelist() if f.endswith('.txt')][0]
        with z.open(txt_file) as f:
            for line in f:
                decoded_line = line.decode('utf-8-sig').strip()
                if not decoded_line:
                    continue
                # Line format: BOOK CHAPTER:VERSE TEXT
                # E.g. "GEN 1:1 In the beginning..."
                parts = decoded_line.split(' ', 2)
                if len(parts) < 3:
                    continue
                book_abbrev = parts[0]
                ref = parts[1]
                verse_text = parts[2]
                
                # Replace typographic quotes/apostrophes with standard ones if needed, or keep them
                # Parse chapter and verse
                if ':' in ref:
                    chap_str, verse_str = ref.split(':', 1)
                    try:
                        chapter = int(chap_str)
                        verse = int(verse_str)
                    except ValueError:
                        continue
                else:
                    continue
                
                book_name = BOOK_MAP.get(book_abbrev, book_abbrev)
                cursor.execute(
                    "INSERT INTO scriptures (translation, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)",
                    ("WEB", book_name, chapter, verse, verse_text)
                )
                count += 1
                
    conn.commit()
    conn.close()
    print(f"WEB Imported: {count} verses.")

if __name__ == "__main__":
    setup_db()
    import_kjv()
    import_web()
    print("Done!")
