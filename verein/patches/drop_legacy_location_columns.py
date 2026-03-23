from __future__ import annotations

import frappe


def execute() -> None:
	for doctype in ("Supporter", "Network"):
		if frappe.db.has_column(doctype, "location"):
			frappe.db.sql_ddl(f"ALTER TABLE `tab{doctype}` DROP COLUMN location")
