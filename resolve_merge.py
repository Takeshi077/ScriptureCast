import sys

def resolve_file(filepath, strategy="v0.1.0"):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.split("\n")
    resolved_lines = []
    
    in_conflict = False
    current_block = ""
    head_content = []
    v0_content = []
    
    for line in lines:
        if line.startswith("<<<<<<< HEAD"):
            in_conflict = True
            current_block = "HEAD"
            head_content = []
            v0_content = []
        elif line.startswith("======="):
            current_block = "V0"
        elif line.startswith(">>>>>>> v0.1.0"):
            in_conflict = False
            if strategy == "HEAD":
                resolved_lines.extend(head_content)
            elif strategy == "v0.1.0":
                resolved_lines.extend(v0_content)
            elif strategy == "both":
                resolved_lines.extend(v0_content)
                resolved_lines.extend(head_content)
        else:
            if in_conflict:
                if current_block == "HEAD":
                    head_content.append(line)
                else:
                    v0_content.append(line)
            else:
                resolved_lines.append(line)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(resolved_lines))

# Resolve Backend to v0.1.0
resolve_file("backend/app.py", "v0.1.0")
resolve_file("backend/auth.py", "v0.1.0")
resolve_file("backend/semantic.py", "v0.1.0")
resolve_file("backend/requirements.txt", "v0.1.0")

# Resolve configs to v0.1.0
resolve_file("src-tauri/Cargo.lock", "v0.1.0")
resolve_file("src-tauri/Cargo.toml", "v0.1.0")
resolve_file("src-tauri/capabilities/default.json", "v0.1.0")
resolve_file("src-tauri/src/lib.rs", "v0.1.0")
resolve_file("src-tauri/tauri.conf.json", "v0.1.0")
resolve_file("render.yaml", "v0.1.0")
resolve_file("start.sh", "v0.1.0")
resolve_file(".gitignore", "v0.1.0")

# Resolve HTML & CSS to HEAD (favoring the user's mobile responsiveness)
resolve_file("frontend/dashboard.html", "HEAD")
resolve_file("frontend/index.html", "HEAD")
resolve_file("frontend/login.html", "HEAD")
resolve_file("frontend/register.html", "HEAD")
resolve_file("frontend/screen.html", "HEAD")
resolve_file("frontend/css/auth.css", "HEAD")
resolve_file("frontend/css/dashboard.css", "HEAD")
resolve_file("frontend/css/screen.css", "HEAD")

# We will handle frontend JS files manually because Momoh added logic but HEAD has UI tweaks
print("Backend, HTML, and CSS resolved.")
