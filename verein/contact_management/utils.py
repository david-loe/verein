from __future__ import annotations

from math import asin, cos, radians, sin, sqrt
from typing import Any

import frappe

ADDRESS_FIELDS = ("address_line_1", "address_line_2", "city", "postal_code", "country")
REQUIRED_ADDRESS_FIELDS = ("address_line_1", "city", "postal_code", "country")
GEO_REFERENCE_DOCTYPES = ("Supporter", "Network")


def has_fields_changed(doc, fields: tuple[str, ...] | set[str], previous_doc) -> bool:
	return any(doc.get(field) != previous_doc.get(field) for field in fields)


def is_address_complete(doc) -> bool:
	return all(doc.get(field) for field in REQUIRED_ADDRESS_FIELDS)


def get_address_data(doc) -> dict[str, Any]:
	return {field: doc.get(field) for field in ADDRESS_FIELDS}


def enqueue_geocoding_job(reference_doctype: str, reference_name: str) -> None:
	if reference_doctype not in GEO_REFERENCE_DOCTYPES:
		frappe.throw(f"Unsupported geocoding reference doctype: {reference_doctype}")

	existing_job = frappe.db.get_value(
		"Geocoding Job",
		{
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
			"status": "Pending",
		},
		"name",
	)
	if existing_job:
		return

	job_values = {
		"doctype": "Geocoding Job",
		"reference_doctype": reference_doctype,
		"reference_name": reference_name,
	}

	frappe.get_doc(job_values).insert(ignore_permissions=True)


def calculate_distance_km(
	latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float
) -> float:
	lat_a_rad = radians(latitude_a)
	lon_a_rad = radians(longitude_a)
	lat_b_rad = radians(latitude_b)
	lon_b_rad = radians(longitude_b)

	delta_lat = lat_b_rad - lat_a_rad
	delta_lon = lon_b_rad - lon_a_rad

	a = (
		sin(delta_lat / 2) ** 2
		+ cos(lat_a_rad) * cos(lat_b_rad) * sin(delta_lon / 2) ** 2
	)
	c = 2 * asin(sqrt(a))

	return 6371.0 * c


def get_bounding_box(
	latitude: float, longitude: float, radius_km: float
) -> tuple[float, float, float, float]:
	lat_delta = radius_km / 111.32
	min_latitude = max(-90.0, latitude - lat_delta)
	max_latitude = min(90.0, latitude + lat_delta)

	cos_latitude = abs(cos(radians(latitude)))
	if cos_latitude < 1e-12:
		return min_latitude, max_latitude, -180.0, 180.0

	lon_delta = radius_km / (111.32 * cos_latitude)
	min_longitude = max(-180.0, longitude - lon_delta)
	max_longitude = min(180.0, longitude + lon_delta)
	return min_latitude, max_latitude, min_longitude, max_longitude
