from flask import Flask, request, jsonify
import tls_client
from time import sleep
from itertools import cycle

app = Flask(__name__)

proxies = [line.rstrip("\n") for line in open("Input/proxies.txt", "r")]
proxy_pool = cycle(proxies)
clients = []
j = 0

def getProxy(i):
    if len(proxies) == 0:
        return None
    proxy = next(proxy_pool)
    if len(proxy.split(':')) == 4:
        splitted = proxy.split(':')
        proxy = f"{splitted[2]}:{splitted[3]}@{splitted[0]}:{splitted[1]}"
    if i != 1:
        return {'https://': 'http://' + proxy}
    if proxy is None:
        return None
    return 'http://' + proxy

@app.route('/register-email-request', methods=['POST'])
def main():
    global j
    resp_data = request.get_json(force=True)

    clients.append(tls_client.Session(client_identifier="chrome_120", random_tls_extension_order=True))
    client = clients[j]
    old_j = j
    j += 1

    client.headers = resp_data["headers"]
    proxy = getProxy(1)
    client.proxies = {"http": proxy, "https": proxy}

    method = resp_data["method"]
    url = resp_data["url"]
    payload = resp_data["data"]
    headers1 = resp_data["headers"]

    print("Forwarding payload:", payload[:200], "...")

    req = send_request(method, client, url, payload, headers1)

    try:
        req_data = req.json()
    except Exception:
        req_data = req.text

    data = {
        "req_data": req_data,
        "headers": headers1,
        "proxy": proxy,
        "j": old_j,
        "status": req.status_code
    }

    return jsonify(data), 200

def send_request(method, client, url, payload, headers):
    try:
        if method == "GET":
            return client.get(url, headers=headers)
        elif method == "POST":
            return client.post(url, data=payload, headers=headers)
    except Exception as e:
        print("Request error:", e)
        sleep(2)
        return send_request(method, client, url, payload, headers)

if __name__ == "__main__":
    clients.append(tls_client.Session(client_identifier="chrome_120", random_tls_extension_order=True))
    app.run(host='127.0.0.1', port=3005)

