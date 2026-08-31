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
		company: DF.Link
		cost_center: DF.Link
		user: DF.Link
	# end: auto-generated types

	def validate(self):
		self.validate_company()
		self.validate_access_level()
		self.validate_active_duplicate()

	def validate_company(self):
		if not self.cost_center:
			return

		cost_center_company = frappe.db.get_value("Cost Center", self.cost_center, "company")
		if not cost_center_company:
			frappe.throw(_("Cost Center {0} was not found.").format(self.cost_center))

		if not self.company:
			self.company = cost_center_company
		elif self.company != cost_center_company:
			frappe.throw(
				_("Cost Center {0} belongs to company {1}, not {2}.").format(
					self.cost_center,
					cost_center_company,
					self.company,
				)
			)

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
