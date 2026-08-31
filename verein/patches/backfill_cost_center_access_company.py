from __future__ import annotations

import frappe


def execute():
	frappe.db.sql(
		"""
		update `tabCost Center Access` cca
		inner join `tabCost Center` cost_center on cost_center.name = cca.cost_center
		set cca.company = cost_center.company
		where cca.company is null or cca.company = ''
		"""
	)
