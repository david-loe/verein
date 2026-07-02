from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, get_first_day, getdate


class CostCenterBudget(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		budget_amount: DF.Currency
		cost_center: DF.Link
		from_date: DF.Date
		notes: DF.SmallText | None
	# end: auto-generated types

	def validate(self):
		self.normalize_from_date()
		self.validate_budget_amount()
		self.validate_duplicate()

	def normalize_from_date(self):
		if self.from_date:
			self.from_date = get_first_day(getdate(self.from_date))

	def validate_budget_amount(self):
		if flt(self.budget_amount) < 0:
			frappe.throw(_("Budget Amount cannot be negative."))

	def validate_duplicate(self):
		duplicate = frappe.db.exists(
			"Cost Center Budget",
			{
				"cost_center": self.cost_center,
				"from_date": self.from_date,
				"name": ["!=", self.name],
			},
		)
		if duplicate:
			frappe.throw(_("A Cost Center Budget already exists for this cost center and start date."))
