from __future__ import annotations

import frappe


def execute() -> None:
	if not frappe.db.has_column("Geocoding Job", "supporter"):
		return

	frappe.db.sql(
		"""
		UPDATE `tabGeocoding Job`
		SET reference_doctype = 'Supporter',
			reference_name = supporter
		WHERE COALESCE(supporter, '') != ''
		  AND (
				COALESCE(reference_doctype, '') = ''
				OR COALESCE(reference_name, '') = ''
			)
		"""
	)
