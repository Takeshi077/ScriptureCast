from PIL import Image

def remove_background(input_path, output_path, threshold=230):
    img = Image.open(input_path).convert("RGBA")
    data = img.getdata()

    new_data = []
    for item in data:
        # Check if pixel is close to white
        if item[0] >= threshold and item[1] >= threshold and item[2] >= threshold:
            # White-ish pixel -> transparent
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)

    img.putdata(new_data)
    img.save(output_path, "PNG")

if __name__ == '__main__':
    remove_background("c:/Users/HomePC/Desktop/ScriptureCast/logo.jpeg", "c:/Users/HomePC/Desktop/ScriptureCast/frontend/logo.png")
