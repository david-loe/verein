from __future__ import annotations

import frappe


def execute() -> None:
	if frappe.db.has_column("Geocoding Job", "supporter"):
		frappe.db.sql_ddl("ALTER TABLE `tabGeocoding Job` DROP COLUMN supporter")
