from __future__ import annotations

import frappe

SUPPORTER_DIMENSION_LABEL = "Supporter"


def after_install() -> None:
	ensure_supporter_accounting_dimension()


def ensure_supporter_accounting_dimension() -> str:
	frappe.db.set_single_value("Accounts Settings", "enable_accounting_dimensions", 1)

	name = frappe.db.get_value(
		"Accounting Dimension",
		{"document_type": SUPPORTER_DIMENSION_LABEL},
		"name",
	)
	if name:
		doc = frappe.get_doc("Accounting Dimension", name)
		if doc.disabled:
			doc.disabled = 0
			doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Accounting Dimension",
				"document_type": SUPPORTER_DIMENSION_LABEL,
				"label": SUPPORTER_DIMENSION_LABEL,
			}
		)
		doc.insert(ignore_permissions=True)

	frappe.clear_cache()
	return str(doc.name)
