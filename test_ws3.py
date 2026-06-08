import asyncio, json, websockets

async def test():
    async with websockets.connect("ws://localhost:8000/ws") as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=3)
        print("Connected")
        await ws.send(json.dumps({"type": "transcript", "text": "For God so loved the world John 3:16"}))
        for i in range(3):
            msg = await asyncio.wait_for(ws.recv(), timeout=3)
            parsed = json.loads(msg)
            t = parsed["type"]
            print(f"  {t}")
            if t == "candidate_verses":
                print(f"  -> {len(parsed['candidates'])} candidates found")

asyncio.run(test())
