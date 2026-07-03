from __future__ import annotations

from frappe.model.document import Document


class SupporterContactChangeRequestField(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		current_value: DF.SmallText | None
		field_label: DF.Data | None
		fieldname: DF.Data
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		requested_value: DF.SmallText | None
	# end: auto-generated types

