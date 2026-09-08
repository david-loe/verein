import frappe
from frappe.desk.search import sanitize_searchfield
from frappe.model.document import Document
from frappe.utils import cint, cstr, now_datetime

from verein.contact_management.utils import (
	REQUIRED_ADDRESS_FIELDS,
	enqueue_geocoding_job,
	has_fields_changed,
	is_address_complete,
)


class Supporter(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF
		from verein.contact_management.doctype.supporter_experience.supporter_experience import SupporterExperience
		from verein.contact_management.doctype.supporter_network.supporter_network import SupporterNetwork

		address_line_1: DF.Data | None
		address_line_2: DF.Data | None
		city: DF.Data | None
		contact_or_address_modified: DF.Data | None
		contact_status_details: DF.LongText | None
		country: DF.Link | None
		date_of_birth: DF.Date | None
		email_address: DF.Data | None
		experiences: DF.Table[SupporterExperience]
		first_name: DF.Data | None
		full_name: DF.Data | None
		gender: DF.Link | None
		image: DF.AttachImage | None
		last_name: DF.Data | None
		latitude: DF.Float
		longitude: DF.Float
		networks: DF.Table[SupporterNetwork]
		phone: DF.Data | None
		postal_code: DF.Data | None
		salutation: DF.Link | None
		spouse: DF.Link | None
		status: DF.Literal["", "Duplicate", "Incomplete Address", "Mailing Notice"]
	# end: auto-generated types

	address_fields = REQUIRED_ADDRESS_FIELDS
	contact_fields = {
		"address_line_2",
		"date_of_birth",
		"email_address",
		"first_name",
		"gender",
		"last_name",
		"phone",
		"salutation",
		"spouse",
	}
	table_link_fields = {"experiences": "experience", "networks": "network"}

	def validate(self) -> None:
		self.full_name = get_full_name(self.first_name, self.last_name)
		self.update_contact_or_address_modified()
		self.validate_unique_relationship_rows()
		self.validate_spouse_link()

	def on_update(self) -> None:
		previous_doc = self.get_doc_before_save()
		address_changed = not previous_doc or has_fields_changed(self, self.address_fields, previous_doc)

		if is_address_complete(self) and address_changed:
			enqueue_geocoding_job("Supporter", self.name)

		self.sync_spouse_link(previous_doc.spouse if previous_doc else None)

	def on_trash(self) -> None:
		if self.spouse and frappe.db.exists("Supporter", self.spouse):
			frappe.db.set_value("Supporter", self.spouse, "spouse", None, update_modified=False)

	def update_contact_or_address_modified(self) -> None:
		previous_doc = self.get_doc_before_save()
		if not previous_doc:
			self.contact_or_address_modified = now_datetime().isoformat()
			return

		address_changed = has_fields_changed(self, self.address_fields, previous_doc)
		contact_changed = has_fields_changed(self, self.contact_fields, previous_doc)
		if address_changed or contact_changed:
			self.contact_or_address_modified = now_datetime().isoformat()

	def validate_unique_relationship_rows(self) -> None:
		for table_field, link_field in self.table_link_fields.items():
			seen = set()
			for row in self.get(table_field) or []:
				link_value = row.get(link_field)
				if not link_value:
					continue
				if link_value in seen:
					frappe.throw(
						frappe._("{0} may only be linked once: {1}").format(
							frappe.bold(frappe.unscrub(link_field)),
							frappe.bold(link_value),
						)
					)
				seen.add(link_value)

	def validate_spouse_link(self) -> None:
		if not self.spouse:
			return

		if self.spouse == self.name:
			frappe.throw(frappe._("A supporter cannot be married to themselves."))

		spouse = frappe.db.get_value("Supporter", self.spouse, ["name", "spouse"], as_dict=True)
		if not spouse:
			frappe.throw(frappe._("The selected spouse does not exist."))

		if spouse.spouse and spouse.spouse != self.name:
			frappe.throw(
				frappe._("{0} is already linked to {1}.").format(
					frappe.bold(self.spouse),
					frappe.bold(spouse.spouse),
				)
			)

	def sync_spouse_link(self, previous_spouse: str | None) -> None:
		if getattr(self.flags, "in_spouse_sync", False):
			return

		self.flags.in_spouse_sync = True
		try:
			if previous_spouse and previous_spouse != self.spouse and frappe.db.exists(
				"Supporter", previous_spouse
			):
				if frappe.db.get_value("Supporter", previous_spouse, "spouse") == self.name:
					frappe.db.set_value("Supporter", previous_spouse, "spouse", None, update_modified=False)

			if self.spouse and frappe.db.exists("Supporter", self.spouse):
				if frappe.db.get_value("Supporter", self.spouse, "spouse") != self.name:
					frappe.db.set_value("Supporter", self.spouse, "spouse", self.name, update_modified=False)
		finally:
			self.flags.in_spouse_sync = False


def get_full_name(first_name: str, last_name: str) -> str:
	return " ".join(filter(None, [cstr(f).strip() for f in [first_name, last_name]]))


@frappe.whitelist()
def supporter_picker_query(
	doctype: str,
	txt: str,
	searchfield: str | None = None,
	start: int = 0,
	page_len: int | None = None,
	filters: dict | list | None = None,
	as_dict: bool = False,
	page_length: int | None = None,
	**kwargs,
):
	searchfield = searchfield or "name"
	sanitize_searchfield(searchfield)
	start = cint(start)
	limit = cint(page_len or page_length or 20)

	fields = ["full_name", "city", "date_of_birth", "name"]
	or_filters = []
	if txt:
		or_filters = [
			["Supporter", "name", "like", f"%{txt}%"],
			["Supporter", "full_name", "like", f"%{txt}%"],
			["Supporter", "city", "like", f"%{txt}%"],
		]

	results = frappe.get_all(
		"Supporter",
		fields=fields,
		filters=filters or {},
		or_filters=or_filters,
		limit_start=start,
		limit_page_length=limit,
		order_by="full_name asc, name asc",
		as_list=not as_dict,
	)
	return results
