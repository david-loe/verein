from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document


class CostCenterAccess(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		access_level: DF.Literal["View", "Manage"]
		active: DF.Check
		cost_center: DF.Link
		user: DF.Link
	# end: auto-generated types

	def validate(self):
		self.validate_access_level()
		self.validate_active_duplicate()

	def validate_access_level(self):
		if self.access_level not in {"View", "Manage"}:
			frappe.throw(_("Access Level must be View or Manage."))

	def validate_active_duplicate(self):
		if not self.active:
			return

		duplicate = frappe.db.exists(
			"Cost Center Access",
			{
				"user": self.user,
				"cost_center": self.cost_center,
				"active": 1,
				"name": ["!=", self.name],
			},
		)
		if duplicate:
			frappe.throw(_("An active Cost Center Access already exists for this user and cost center."))
