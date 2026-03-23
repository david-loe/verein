# Copyright (c) 2025, david-loe and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cstr, now_datetime

class Supporter(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF
        from verein.contact_management.doctype.supporter_experience.supporter_experience import SupporterExperience
        from verein.contact_management.doctype.supporter_network.supporter_network import SupporterNetwork

        address_line_1: DF.Data | None
        address_line_2: DF.Data | None
        city: DF.Data | None
        contact_or_address_modified: DF.Data | None
        country: DF.Link | None
        date_of_birth: DF.Date | None
        email_address: DF.Data | None
        experiences: DF.Table[SupporterExperience]
        first_name: DF.Data | None
        full_name: DF.Data | None
        gender: DF.Link | None
        image: DF.AttachImage | None
        last_name: DF.Data | None
        networks: DF.Table[SupporterNetwork]
        phone: DF.Data | None
        postal_code: DF.Data | None
        salutation: DF.Link | None
    # end: auto-generated types

    # Felder, die für Adress- bzw. Kontaktdaten relevant sind
    address_fields = {"address_line_1", "city", "postal_code", "country"}
    contact_fields = {"address_line_2", "date_of_birth", "gender", "first_name", "last_name", "email_address", "phone", "salutation"}

    def has_fields_changed(self, fields: set, previous_doc: dict) -> bool:
        """
        Prüft, ob sich einer der angegebenen Felder im aktuellen Dokument im Vergleich zum vorherigen Dokument geändert hat.
        """
        return any(self.get(field) != previous_doc.get(field) for field in fields)

    def on_update(self) -> None:
        """
        Aktualisiert das Änderungsdatum für Kontakt- oder Adressdaten und löst bei Bedarf einen neuen Geocoding-Job aus.
        """
        previous_doc = self.get_doc_before_save() or {}
        is_new = self.get("__islocal")

        # Prüfen, ob Adress- bzw. Kontaktfelder geändert wurden
        addr_changed = previous_doc and self.has_fields_changed(self.address_fields, previous_doc)
        contact_changed = previous_doc and self.has_fields_changed(self.contact_fields, previous_doc)

        # Neuer Geocoding-Job, wenn Adresse komplett und neu oder geändert
        if all(self.get(f) for f in self.address_fields) and (is_new or addr_changed):
            frappe.new_doc("Geocoding Job", supporter=self.name).insert(ignore_permissions=True)

        # Wenn weder Adresse noch Kontakt geändert und nicht neu, bleibt alles unverändert
        if not (is_new or addr_changed or contact_changed):
            return

        # An dieser Stelle wissen wir: entweder neu, oder Adresse geändert, oder Kontakt geändert
        # Timestamp nur aktualisieren, wenn er noch leer war oder wirklich noch der alte Wert ist
        if (not self.contact_or_address_modified
            or self.contact_or_address_modified == previous_doc.get("contact_or_address_modified")):
            self.contact_or_address_modified = now_datetime().isoformat()
        

    def validate(self) -> None:
        """
        Führt Validierungen vor dem Speichern des Dokuments durch, z. B. das Setzen des vollständigen Namens.
        """
        self.full_name = get_full_name(self.first_name, self.last_name)


def get_full_name(first_name: str, last_name: str) -> str:
    """
    Kombiniert Vor- und Nachname zu einem vollständigen Namen.
    """
    return " ".join(filter(None, [cstr(f).strip() for f in [first_name, last_name]]))
