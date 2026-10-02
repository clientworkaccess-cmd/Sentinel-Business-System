"""Connectors (#11–#13): Composio-brokered accounts synced into the company brain.

    gateway.py   the Composio seam (OAuth links, account status, proxied provider calls)
    base.py      the Connector interface and the SourceDocument it produces
    google.py    Gmail, Google Calendar, Google Drive
    slack.py     Slack
    registry.py  catalogue id → connector
    ingest.py    SourceDocuments → brain_items + HydraDB
    runner.py    one sync run: lease, loop, cursor, failure handling
    service.py   connect / callback / disconnect / status, used by the routes
"""
