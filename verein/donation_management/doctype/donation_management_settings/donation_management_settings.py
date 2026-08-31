from __future__ import annotations

from frappe.model.document import Document


class DonationManagementSettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		allow_group_cost_centers: DF.Check
	# end: auto-generated types

	pass
