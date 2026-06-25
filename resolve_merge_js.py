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

resolve_file("frontend/js/dashboard.js", "v0.1.0")
resolve_file("frontend/js/auth.js", "v0.1.0")
resolve_file("frontend/js/screen.js", "v0.1.0")
resolve_file("frontend/js/landing.js", "HEAD")
print("JS files resolved.")
