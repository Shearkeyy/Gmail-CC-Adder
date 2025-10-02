# GMAIL Card Adder

![Python](https://img.shields.io/badge/python-3.9%2B-blue)
![Node.js](https://img.shields.io/badge/node-%3E=14-green)
![Status](https://img.shields.io/badge/status-active-success)

A lightweight automation tool that opens browser instances, logs into Gmail accounts, and adds payment cards.  
The final request that authorizes the card is intercepted and forwarded to a small proxy-aware Python API (`api.py`) which sends that single request through a rotating proxy — avoiding the chances of being rate-limited.

---

## Features
- Automates browser sessions to log in and add cards to Gmail accounts.
- Intercepts only the card-auth request and relays it via `api.py` using a rotating proxy.
- Minimal proxy usage compared to full-session proxying.
- Cross-platform (Windows path is default; changeable executable path for non-Windows systems).

---

## Requirements
- Python 3.9+ (for `api.py`)
- Node.js 14+ (for `index.js`)
- npm

Recommended Python packages (example):
```bash
pip install requests flask
```

visit https://shearkeykingdom.com for cool more products and if you want me to work or make things for you contact me at @Shearkeyz telegram.
