import frappe
from frappe.model.document import Document

from verein.contact_management.supporter_links import (
	add_supporters_to_target,
	get_linked_supporters_for_target,
	remove_supporter_from_target,
)


class Experience(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		date: DF.Date | None
		experience_name: DF.Data
		type: DF.Link
	# end: auto-generated types

@frappe.whitelist()
def get_linked_supporters(experience: str) -> list[dict[str, str | None]]:
	return get_linked_supporters_for_target("Experience", experience)


@frappe.whitelist()
def add_supporters(experience: str, supporter_names: list[str] | str) -> list[dict[str, str | None]]:
	return add_supporters_to_target("Experience", experience, supporter_names)


@frappe.whitelist()
def remove_supporter(experience: str, supporter_name: str) -> list[dict[str, str | None]]:
	return remove_supporter_from_target("Experience", experience, supporter_name)
