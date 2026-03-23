from __future__ import annotations

import frappe


def execute() -> None:
	old_name = "Geocoding API Settings"
	new_name = "Geo Settings"

	if frappe.db.exists("DocType", old_name):
		frappe.rename_doc("DocType", old_name, new_name, force=True)

	if frappe.db.exists("Singles", {"doctype": old_name}):
		rows = frappe.get_all("Singles", filters={"doctype": old_name}, fields=["field", "value"])
		for row in rows:
			frappe.db.set_single_value(new_name, row.field, row.value, update_modified=False)

		frappe.db.delete("Singles", {"doctype": old_name})
