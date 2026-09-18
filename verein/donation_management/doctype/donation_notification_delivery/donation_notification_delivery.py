from __future__ import annotations

from frappe.model.document import Document


class DonationNotificationDelivery(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		active_since: DF.Datetime
		cost_center: DF.Data
		email_queue: DF.Data | None
		gl_entry: DF.Data
		status: DF.Literal["Pending", "Queued", "Skipped"]
		user: DF.Link
	# end: auto-generated types

	pass
