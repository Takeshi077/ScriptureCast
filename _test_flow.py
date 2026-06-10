import asyncio
import json
import websockets

async def test():
    async with websockets.connect("ws://localhost:8000/ws", open_timeout=15) as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=10)
        data = json.loads(msg)
        print("Initial:", data.get("type"))

        await ws.send(json.dumps({"type": "transcript", "text": "John 3:16"}))

        for i in range(5):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                data = json.loads(msg)
                print(f"Msg {i}: type={data.get('type')}")
                if data.get("type") == "candidate_verses":
                    print(f"  candidates={len(data.get('candidates', []))}")
                if data.get("type") == "state":
                    print(f"  active_scripture={data.get('active_scripture') is not None}")
            except asyncio.TimeoutError:
                print(f"Timeout after {i} messages")
                break

asyncio.run(test())
