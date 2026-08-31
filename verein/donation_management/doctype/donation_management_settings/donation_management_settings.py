from __future__ import annotations

from frappe.model.document import Document


class DonationManagementSettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		allow_group_cost_centers: DF.Check
		cost_center_display: DF.Literal["Cost Center Name", "Cost Center Number and Name"]
	# end: auto-generated types

	pass
