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
                msg = await asyncio.wait_for(ws.recv(), timeout=3.0)
                data = json.loads(msg)
                t = data.get('type', '?')
                print('Msg %d: type=%s' % (i + 3, t))
                if t == 'candidate_verses':
                    c = data.get('candidates', [])
                    print('  candidates: %d' % len(c))
            except asyncio.TimeoutError:
                print('No msg for 3s (iteration %d)' % i)
                break

asyncio.run(test())
