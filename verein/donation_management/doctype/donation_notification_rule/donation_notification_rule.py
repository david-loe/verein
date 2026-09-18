from __future__ import annotations

from frappe.model.document import Document


class DonationNotificationRule(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		active_since: DF.Datetime | None
		cost_center: DF.Link
		notify_large_donation: DF.Check
		notify_new_donor: DF.Check
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		threshold: DF.Currency
	# end: auto-generated types

	pass
