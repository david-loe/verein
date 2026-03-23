# Contact Management Module

## Purpose
- Verwalten von `Supporter`, `Network` und `Experience` einschliesslich ihrer Beziehungen.
- Pflegen von Kontakt-, Adress- und Geo-Daten fuer ortsbezogene Suche und Auswertungen.
- Abbilden der Beziehungen `Supporter -> Network` und `Supporter -> Experience` ueber Child Tables.

## Core DocTypes
- `Supporter`: Personenstammdaten, Kontaktangaben, Adresse, Geo-Koordinaten, Netzwerke, Experiences und Ehepartner-Verknuepfung.
- `Network`: Gruppierung oder Umfeld eines Supporters, mit Typ, Adresse und Geo-Koordinaten.
- `Experience`: Ereignis oder Erfahrungseintrag mit Typ und Datum.
- `Supporter Network`: Child Table auf `Supporter` fuer die Zuordnung zu Netzwerken.
- `Supporter Experience`: Child Table auf `Supporter` fuer die Zuordnung zu Experiences.
- `Geocoding Job`: Hintergrundjob zur Aufloesung von Adressen in Geo-Koordinaten.
- `Geo Settings`: Konfiguration des externen Geocoding-Endpunkts und der Karten-Defaults.

## Data Ownership
- Die Zuordnung zwischen `Supporter` und `Network` wird ausschliesslich in `Supporter.networks` gespeichert.
- Die Zuordnung zwischen `Supporter` und `Experience` wird ausschliesslich in `Supporter.experiences` gespeichert.
- Listen in `Network` und `Experience` sind abgeleitete Sichten auf diese Child Tables und duplizieren keine Relation.
- Geo-Daten werden direkt in `latitude` und `longitude` auf `Supporter` und `Network` gespeichert.

## Business Rules
- Ein `Supporter` kann hoechstens einen Ehepartner haben.
- Die Ehepartner-Verknuepfung ist bidirektional und muss auf beiden Seiten konsistent sein.
- Geocoding wird nur angestossen, wenn eine vollstaendige Adresse vorliegt.
- Radiussuchen setzen gueltige Geo-Koordinaten auf den Datensaetzen voraus.
- Bei `Supporter` muessen Radiusfilter mit Standardfiltern sowie Netzwerk-/Experience-Filtern kombinierbar sein.

## Implementation Notes
- Form-seitige Erweiterungen liegen direkt in den jeweiligen `doctype/<name>/<name>.js` Dateien.
- Python-Logik liegt direkt in den jeweiligen `doctype/<name>/<name>.py` Klassen; es gibt keine parallele Mixin-Struktur fuer diese DocTypes.
- Schema-Aenderungen werden direkt in den Standard-DocType-JSONs gepflegt; es gibt keine Fallback-Customizations fuer diese DocTypes.
- Serverlogik fuer Radiussuche liegt in `verein/contact_management/page/geo_radius_search/geo_radius_search.py`.
- Gemeinsame Geo-Helfer und Geocoding-Utilities liegen in `verein/contact_management/utils.py`.
- Gemeinsame Reverse-Relationslogik liegt in `verein/contact_management/supporter_links.py`.
- Die Desk-Page fuer die Umkreissuche liegt unter `verein/contact_management/page/geo_radius_search/`.

## Testing Focus
- Ehepartner-Synchronisierung und Konfliktvalidierung.
- Geocoding fuer `Supporter` und `Network`.
- Reverse-Listen in `Network` und `Experience`.
- Radiussuche inklusive kombinierter Filter und Distanzsortierung.
