# Donation Management Module

## Dashboard Data
- Datenquelle fuer Dashboard-Auswertungen ist immer `GL Entry`.
- Aggregationen werden serverseitig berechnet und duerfen nicht aus clientseitig gefilterten Daten abgeleitet werden.

## Access Control
- Zugriff wird immer serverseitig ueber `Cost Center Access` geprueft.
- Client-Filter duerfen nie als Sicherheitsgrenze gelten.
- Zugriff auf eine Gruppen-Kostenstelle umfasst ihre Unterkostenstellen.

