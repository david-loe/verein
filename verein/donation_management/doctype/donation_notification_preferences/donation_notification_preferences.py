from __future__ import annotations

from frappe.model.document import Document


class DonationNotificationPreferences(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from verein.donation_management.doctype.donation_notification_rule.donation_notification_rule import (
			DonationNotificationRule,
		)

		last_digest_date: DF.Date | None
		rules: DF.Table[DonationNotificationRule]
		user: DF.Link
	# end: auto-generated types

	def validate(self):
		from verein.donation_management.notifications import validate_preferences

		validate_preferences(self)
