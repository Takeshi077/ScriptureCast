import asyncio, json
import websockets

async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        msg = await asyncio.wait_for(ws.recv(), timeout=5)
        print('1st msg type:', json.loads(msg).get('type'))
        msg = await asyncio.wait_for(ws.recv(), timeout=5)
        print('2nd msg type:', json.loads(msg).get('type'))

        print('Sending simulated speech...')
        await ws.send(json.dumps({'type': 'simulated_speech', 'text': 'For God so loved the world'}))

        for i in range(20):
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                data = json.loads(msg)
                t = data.get('type', '?')
                txt = str(data.get('text', ''))[:50] if data.get('text') else 'N/A'
                rb = len(data.get('rolling_buffer_text', '')) if 'rolling_buffer_text' in data else 'N/A'
                print(f'Msg {i+3}: type={t} text={txt} rolling_len={rb}')
            except asyncio.TimeoutError:
                print(f'No msg for 1s (iteration {i})')
                break

asyncio.run(test())
