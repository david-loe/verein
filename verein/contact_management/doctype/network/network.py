import frappe
from frappe.model.document import Document

from verein.contact_management.supporter_links import (
	add_supporters_to_target,
	get_linked_supporters_for_target,
	remove_supporter_from_target,
)
from verein.contact_management.utils import (
	REQUIRED_ADDRESS_FIELDS,
	enqueue_geocoding_job,
	has_fields_changed,
	is_address_complete,
)


class Network(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		address_line_1: DF.Data | None
		address_line_2: DF.Data | None
		city: DF.Data | None
		country: DF.Link | None
		latitude: DF.Float
		longitude: DF.Float
		network_name: DF.Data
		postal_code: DF.Data | None
		type: DF.Link
	# end: auto-generated types

	address_fields = REQUIRED_ADDRESS_FIELDS

	def on_update(self) -> None:
		previous_doc = self.get_doc_before_save()
		address_changed = not previous_doc or has_fields_changed(self, self.address_fields, previous_doc)

		if is_address_complete(self) and address_changed:
			enqueue_geocoding_job("Network", self.name)


@frappe.whitelist()
def get_linked_supporters(network: str) -> list[dict[str, str | None]]:
	return get_linked_supporters_for_target("Network", network)


@frappe.whitelist()
def add_supporters(network: str, supporter_names: list[str] | str) -> list[dict[str, str | None]]:
	return add_supporters_to_target("Network", network, supporter_names)


@frappe.whitelist()
def remove_supporter(network: str, supporter_name: str) -> list[dict[str, str | None]]:
	return remove_supporter_from_target("Network", network, supporter_name)
