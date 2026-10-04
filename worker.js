import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Optional secret verification
    const secret = request.headers.get('X-Proxy-Secret') || '';
    if (env.PROXY_SECRET && secret !== env.PROXY_SECRET) {
      return new Response('Unauthorized secret', { status: 401 });
    }

    const targetHost = request.headers.get('X-Target-Host') || '149.154.167.50'; // Default Telegram DC
    const targetPort = parseInt(request.headers.get('X-Target-Port') || '443', 10);

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();

    // Connect to Telegram IP:Port over TCP socket
    let tcpSocket;
    try {
      tcpSocket = connect({ hostname: targetHost, port: targetPort });
    } catch (err) {
      server.close(1011, 'TCP connect failed: ' + err.message);
      return new Response(null, { status: 101, webSocket: client });
    }

    const writer = tcpSocket.writable.getWriter();
    const reader = tcpSocket.readable.getReader();

    // Pipe WS -> TCP
    server.addEventListener('message', async (event) => {
      try {
        let data = event.data;
        if (typeof data === 'string') {
          data = new TextEncoder().encode(data);
        } else if (data instanceof ArrayBuffer) {
          data = new Uint8Array(data);
        }
        await writer.write(data);
      } catch (err) {
        server.close(1011, 'Write to TCP failed');
      }
    });

    // Pipe TCP -> WS
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            server.send(value.buffer);
          }
        }
      } catch (err) {
        // TCP read error
      } finally {
        try { server.close(1000, 'TCP closed'); } catch (_) {}
      }
    })();

    server.addEventListener('close', () => {
      try { tcpSocket.close(); } catch (_) {}
    });

    return new Response(null, { status: 101, webSocket: client });
  }
};
