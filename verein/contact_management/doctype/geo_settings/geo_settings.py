# Copyright (c) 2026, david-loe and contributors

from __future__ import annotations

import frappe
from frappe.model.document import Document

DEFAULT_MAP_VALUES = {
	"latitude": 51.1657,
	"longitude": 10.4515,
	"zoom": 6,
}


class GeoSettings(Document):
	pass


@frappe.whitelist()
def get_map_defaults() -> dict[str, float]:
	try:
		settings = frappe.get_single("Geo Settings")
	except frappe.DoesNotExistError:
		return DEFAULT_MAP_VALUES.copy()

	return {
		"latitude": settings.default_map_latitude or DEFAULT_MAP_VALUES["latitude"],
		"longitude": settings.default_map_longitude or DEFAULT_MAP_VALUES["longitude"],
		"zoom": settings.default_map_zoom or DEFAULT_MAP_VALUES["zoom"],
	}
