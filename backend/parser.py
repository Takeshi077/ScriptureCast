import re

# Refined map of book abbreviations to prevent common word false positives
BOOK_ABBREVIATIONS = {
    # Old Testament
    "genesis": "Genesis", "gen": "Genesis", "ge": "Genesis", "gn": "Genesis",
    "exodus": "Exodus", "exo": "Exodus", "exod": "Exodus",
    "leviticus": "Leviticus", "lev": "Leviticus",
    "numbers": "Numbers", "num": "Numbers", "nm": "Numbers", "nbr": "Numbers",
    "deuteronomy": "Deuteronomy", "deut": "Deuteronomy", "dt": "Deuteronomy",
    "joshua": "Joshua", "josh": "Joshua", "jos": "Joshua",
    "judges": "Judges", "judg": "Judges", "jg": "Judges", "jdg": "Judges",
    "ruth": "Ruth", "rut": "Ruth",
    "1 samuel": "1 Samuel", "1 sam": "1 Samuel", "1sa": "1 Samuel", "1s": "1 Samuel", "i samuel": "1 Samuel", "i sam": "1 Samuel", "1st samuel": "1 Samuel", "1st sam": "1 Samuel",
    "2 samuel": "2 Samuel", "2 sam": "2 Samuel", "2sa": "2 Samuel", "2s": "2 Samuel", "ii samuel": "2 Samuel", "ii sam": "2 Samuel", "2nd samuel": "2 Samuel", "2nd sam": "2 Samuel",
    "1 kings": "1 Kings", "1 ki": "1 Kings", "1ki": "1 Kings", "1k": "1 Kings", "i kings": "1 Kings", "i ki": "1 Kings", "1st kings": "1 Kings",
    "2 kings": "2 Kings", "2 ki": "2 Kings", "2ki": "2 Kings", "2k": "2 Kings", "ii kings": "2 Kings", "ii ki": "2 Kings", "2nd kings": "2 Kings",
    "1 chronicles": "1 Chronicles", "1 chron": "1 Chronicles", "1ch": "1 Chronicles", "i chronicles": "1 Chronicles", "i chron": "1 Chronicles", "1st chronicles": "1 Chronicles",
    "2 chronicles": "2 Chronicles", "2 chron": "2 Chronicles", "2ch": "2 Chronicles", "ii chronicles": "2 Chronicles", "ii chron": "2 Chronicles", "2nd chronicles": "2 Chronicles",
    "ezra": "Ezra", "ezr": "Ezra",
    "nehemiah": "Nehemiah", "neh": "Nehemiah",
    "esther": "Esther", "esth": "Esther", "est": "Esther",
    "job": "Job",
    "psalms": "Psalms", "psalm": "Psalms", "psa": "Psalms", "ps": "Psalms", "pss": "Psalms",
    "proverbs": "Proverbs", "prov": "Proverbs", "pro": "Proverbs", "prv": "Proverbs",
    "ecclesiastes": "Ecclesiastes", "eccles": "Ecclesiastes", "ecc": "Ecclesiastes", "qoh": "Ecclesiastes",
    "song of solomon": "Song of Solomon", "song of songs": "Song of Solomon", "song": "Song of Solomon", "canticles": "Song of Solomon", "cant": "Song of Solomon", "sos": "Song of Solomon",
    "isaiah": "Isaiah", "isa": "Isaiah",
    "jeremiah": "Jeremiah", "jer": "Jeremiah", "jrm": "Jeremiah",
    "lamentations": "Lamentations", "lam": "Lamentations",
    "ezekiel": "Ezekiel", "ezek": "Ezekiel", "ezk": "Ezekiel",
    "daniel": "Daniel", "dan": "Daniel", "dn": "Daniel",
    "hosea": "Hosea", "hos": "Hosea",
    "joel": "Joel", "jl": "Joel",
    "amos": "Amos", "amo": "Amos",
    "obadiah": "Obadiah", "obad": "Obadiah",
    "jonah": "Jonah", "jon": "Jonah", "jnh": "Jonah",
    "micah": "Micah", "mic": "Micah",
    "nahum": "Nahum", "nah": "Nahum",
    "habakkuk": "Habakkuk", "hab": "Habakkuk",
    "zephaniah": "Zephaniah", "zeph": "Zephaniah", "zep": "Zephaniah",
    "haggai": "Haggai", "hag": "Haggai",
    "zechariah": "Zechariah", "zech": "Zechariah", "zec": "Zechariah",
    "malachi": "Malachi", "mal": "Malachi",
    
    # New Testament
    "matthew": "Matthew", "matt": "Matthew", "mat": "Matthew", "mt": "Matthew",
    "mark": "Mark", "mar": "Mark", "mk": "Mark", "mrk": "Mark",
    "luke": "Luke", "luk": "Luke", "lk": "Luke",
    "john": "John", "joh": "John", "jn": "John", "jhn": "John",
    "acts": "Acts", "act": "Acts",
    "romans": "Romans", "rom": "Romans", "rm": "Romans",
    "1 corinthians": "1 Corinthians", "1 cor": "1 Corinthians", "1co": "1 Corinthians", "1c": "1 Corinthians", "i corinthians": "1 Corinthians", "i cor": "1 Corinthians", "1st corinthians": "1 Corinthians",
    "2 corinthians": "2 Corinthians", "2 cor": "2 Corinthians", "2co": "2 Corinthians", "2c": "2 Corinthians", "ii corinthians": "2 Corinthians", "ii cor": "2 Corinthians", "2nd corinthians": "2 Corinthians",
    "galatians": "Galatians", "gal": "Galatians", "ga": "Galatians",
    "ephesians": "Ephesians", "ephes": "Ephesians", "eph": "Ephesians",
    "philippians": "Philippians", "phil": "Philippians", "php": "Philippians",
    "colossians": "Colossians", "col": "Colossians",
    "1 thessalonians": "1 Thessalonians", "1 thess": "1 Thessalonians", "1th": "1 Thessalonians", "1t": "1 Thessalonians", "i thessalonians": "1 Thessalonians", "i thess": "1 Thessalonians", "1st thessalonians": "1 Thessalonians",
    "2 thessalonians": "2 Thessalonians", "2 thess": "2 Thessalonians", "2th": "2 Thessalonians", "2t": "2 Thessalonians", "ii thessalonians": "2 Thessalonians", "ii thess": "2 Thessalonians", "2nd thessalonians": "2 Thessalonians",
    "1 timothy": "1 Timothy", "1 tim": "1 Timothy", "1ti": "1 Timothy", "1t": "1 Timothy", "i timothy": "1 Timothy", "i tim": "1 Timothy", "1st timothy": "1 Timothy",
    "2 timothy": "2 Timothy", "2 tim": "2 Timothy", "2ti": "2 Timothy", "2t": "2 Timothy", "ii timothy": "2 Timothy", "ii tim": "2 Timothy", "2nd timothy": "2 Timothy",
    "titus": "Titus", "tit": "Titus",
    "philemon": "Philemon", "philem": "Philemon", "phm": "Philemon",
    "hebrews": "Hebrews", "hebr": "Hebrews", "heb": "Hebrews",
    "james": "James", "jas": "James",
    "1 peter": "1 Peter", "1 pet": "1 Peter", "1pe": "1 Peter", "1p": "1 Peter", "i peter": "1 Peter", "i pet": "1 Peter", "1st peter": "1 Peter",
    "2 peter": "2 Peter", "2 pet": "2 Peter", "2pe": "2 Peter", "2p": "2 Peter", "ii peter": "2 Peter", "ii pet": "2 Peter", "2nd peter": "2 Peter",
    "1 john": "1 John", "1 jn": "1 John", "1j": "1 John", "i john": "1 John", "i jn": "1 John", "1st john": "1 John",
    "2 john": "2 John", "2 jn": "2 John", "2j": "2 John", "ii john": "2 John", "ii jn": "2 John", "2nd john": "2 John",
    "3 john": "3 John", "3 jn": "3 John", "3j": "3 John", "iii john": "3 John", "iii jn": "3 John", "3rd john": "3 John",
    "jude": "Jude", "jud": "Jude",
    "revelation": "Revelation", "rev": "Revelation", "revel": "Revelation"
}

# Sort keys by length in descending order to match longer terms first (e.g. "1 Corinthians" before "1")
SORTED_BOOK_KEYS = sorted(BOOK_ABBREVIATIONS.keys(), key=len, reverse=True)

BOOK_PATTERN = r'\b(?:' + '|'.join(map(re.escape, SORTED_BOOK_KEYS)) + r')\b'

# Revised Regex Pattern:
# Group 1: Book name/abbreviation
# Group 2: Chapter number
# Group 3: Optional separator (colon, comma + space, space, "verse", etc.)
# Group 4: Verse start number
# Group 5: Verse end number (if range)
REF_REGEX = re.compile(
    r'\b(' + BOOK_PATTERN + r')'                                                    # Book name
    r'(?:\s+(?:chapter|chap\.?)\s+|\s+)?(\d+)'                                    # Chapter number
    r'(?:(?:\s*(?::|,?\s+verse|,?\s+verses|,?\s+v\.?|\s+)\s*)(\d+)(?:\s*(?:-|to)\s*(\d+))?)?', # Verse(s)
    re.IGNORECASE
)

def parse_text_for_verses(text):
    results = []
    if not text:
        return results
    
    for match in REF_REGEX.finditer(text):
        raw_match = match.group(0)
        book_raw = match.group(1).lower()
        chapter_str = match.group(2)
        verse_start_str = match.group(3)
        verse_end_str = match.group(4)
        
        normalized_book = BOOK_ABBREVIATIONS.get(book_raw)
        if not normalized_book:
            continue
        
        try:
            chapter = int(chapter_str)
        except ValueError:
            continue
        
        verse_start = None
        verse_end = None
        
        if verse_start_str:
            try:
                verse_start = int(verse_start_str)
            except ValueError:
                pass
        
        if verse_end_str:
            try:
                verse_end = int(verse_end_str)
            except ValueError:
                pass
        
        # Calculate confidence
        confidence = 65  # Base confidence for book and chapter
        
        if verse_start:
            confidence = 85  # Has starting verse
            if ':' in raw_match or 'verse' in raw_match.lower() or 'v' in raw_match.lower() or ',' in raw_match:
                confidence = 95
            if verse_end:
                confidence = 98
        
        if len(book_raw) <= 2 and not verse_start:
            confidence = 45
            
        results.append({
            "raw_match": raw_match,
            "book": normalized_book,
            "chapter": chapter,
            "verse_start": verse_start,
            "verse_end": verse_end,
            "confidence": confidence
        })
        
    return results

if __name__ == "__main__":
    tests = [
        "Let's look at John 3:16 today.",
        "Please turn to Genesis 1.",
        "Read Romans 8, verse 28 for encouragement.",
        "Our text is 1 Corinthians 13:4-8.",
        "Go to Jn 15.",
        "Let's read Heb 11 verse 1 to 3."
    ]
    for test in tests:
        print(f"Text: '{test}'")
        parsed = parse_text_for_verses(test)
        print(f"Parsed: {parsed}\n")
