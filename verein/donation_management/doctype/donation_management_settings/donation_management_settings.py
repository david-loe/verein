from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


def get_review_supporter_display_fields():
	meta = frappe.get_meta("Supporter")
	stored_fields = set(meta.get_valid_columns())
	return {
		field.fieldname: field
		for field in meta.fields
		if field.fieldname in stored_fields
		and not (field.hidden or field.permlevel or field.get("mask") or field.fieldtype == "Password")
	}


class DonationManagementSettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		allow_group_cost_centers: DF.Check
		cost_center_display: DF.Literal["Cost Center Name", "Cost Center Number and Name"]
		review_supporter_display_field: DF.Literal[None]
	# end: auto-generated types

	def onload(self) -> None:
		field = self.meta.get_field("review_supporter_display_field")
		if not field or not self.has_permlevel_access_to(field.fieldname, field, permission_type="read"):
			return

		self.set_onload(
			"review_supporter_display_fields",
			[
				{"fieldname": field.fieldname, "label": field.label or field.fieldname}
				for field in get_review_supporter_display_fields().values()
			],
		)

	def validate(self) -> None:
		fieldname = self.get("review_supporter_display_field")
		if (
			fieldname
			and self.has_value_changed("review_supporter_display_field")
			and fieldname not in get_review_supporter_display_fields()
		):
			frappe.throw(_("Select a Supporter field that can be shared with request readers."))
