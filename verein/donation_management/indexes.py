from __future__ import annotations

import frappe

GL_ENTRY_REPORTING_INDEX = "dm_cost_center_cancelled_posting_date"


def ensure_donation_management_indexes() -> None:
	frappe.db.add_index(
		"GL Entry",
		["cost_center", "is_cancelled", "posting_date"],
		index_name=GL_ENTRY_REPORTING_INDEX,
	)
