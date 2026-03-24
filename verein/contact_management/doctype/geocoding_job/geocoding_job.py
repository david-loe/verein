import time
from typing import Any

import frappe
import requests
from frappe.model.document import Document

from verein.contact_management.utils import GEO_REFERENCE_DOCTYPES, get_address_data


@frappe.whitelist()
def run_job_async(doc: str):
	doc_data = frappe.parse_json(doc)
	doc_instance = frappe.get_doc("Geocoding Job", doc_data["name"])
	frappe.enqueue(doc_instance.run)
	frappe.msgprint(frappe._("Geocoding job has been queued."))


class GeocodingJob(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		error_message: DF.Text | None
		reference_doctype: DF.Link | None
		reference_name: DF.DynamicLink | None
		status: DF.Literal["Completed", "Failed", "Pending"]
	# end: auto-generated types

	def validate(self) -> None:
		if self.reference_doctype and self.reference_doctype not in GEO_REFERENCE_DOCTYPES:
			frappe.throw(
				frappe._("Reference DocType must be one of the following values: {0}").format(
					", ".join(GEO_REFERENCE_DOCTYPES)
				)
			)

	def run(self, settings: dict | None = None):
		settings = settings or frappe.get_single("Geo Settings")
		if not (settings.get("url") and settings.get("lat_param") and settings.get("lon_param")):
			return

		reference_doctype, reference_name = self.get_reference()
		if not reference_doctype or not reference_name:
			self.update({"status": "Failed", "error_message": "Geocoding reference is missing"})
			self.save()
			return

		try:
			target_doc = frappe.get_doc(reference_doctype, reference_name)
		except frappe.DoesNotExistError:
			self.update(
				{
					"status": "Failed",
					"error_message": f"{reference_doctype} {reference_name} not found",
				}
			)
			self.save()
			return

		api_url = frappe.render_template(settings.url, get_address_data(target_doc))

		try:
			app_name = frappe.get_hooks("app_name")[0]
			app_version = frappe.get_hooks("app_version")[0]
			site_url = frappe.utils.get_url()
			headers = {"User-Agent": f"{app_name}/{app_version} (+{site_url})", "Referer": site_url}
			if settings.headers:
				headers.update(frappe.parse_json(settings.headers))

			response = requests.get(api_url, headers=headers, timeout=30)
			response.raise_for_status()
			data = response.json()

			latitude = get_nested_value(data, settings.lat_param)
			longitude = get_nested_value(data, settings.lon_param)
			if isinstance(latitude, str):
				latitude = float(latitude)
			if isinstance(longitude, str):
				longitude = float(longitude)
			if latitude is None or longitude is None:
				raise ValueError(f"Coordinates could not be extracted from the response: {data}")

			frappe.db.set_value(
				reference_doctype,
				reference_name,
				{"latitude": latitude, "longitude": longitude},
				update_modified=False,
			)

			self.status = "Completed"
			self.error_message = None
		except Exception as error:
			self.update({"status": "Failed", "error_message": str(error)})
			frappe.log_error(message=str(error), title=frappe._("Geocoding Error"))

		self.save()
		frappe.db.commit()

	def get_reference(self) -> tuple[str | None, str | None]:
		if self.reference_doctype and self.reference_name:
			return self.reference_doctype, self.reference_name
		return None, None


def get_nested_value(data: Any, key_path: str):
	for key in key_path.split("."):
		if isinstance(data, list):
			try:
				index = int(key)
				data = data[index]
				continue
			except (ValueError, IndexError):
				return None

		if isinstance(data, dict):
			if key in data:
				data = data[key]
			else:
				return None
		else:
			return None
	return data


def process_geocoding_queue():
	settings = frappe.get_single("Geo Settings")
	if settings.url:
		jobs = frappe.get_all("Geocoding Job", filters={"status": "Pending"})
		for job in jobs:
			job_doc = frappe.get_doc("Geocoding Job", job.name)
			job_doc.run(settings)
			if settings.req_interval_ms > 0:
				time.sleep(settings.req_interval_ms / 1000.0)


def delete_successfull_jobs_older_than_1_week():
	frappe.db.sql(
		"""
		DELETE FROM `tabGeocoding Job`
		WHERE status = 'Completed'
		AND modified < DATE_SUB(NOW(), INTERVAL 1 WEEK)
		"""
	)
