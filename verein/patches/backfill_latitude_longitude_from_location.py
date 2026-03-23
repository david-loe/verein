from __future__ import annotations

import json
from typing import Any

import frappe
from frappe.database.schema import add_column

TARGET_DOCTYPES = ("Supporter", "Network")
COORDINATE_FIELDS = ("latitude", "longitude")


def execute() -> None:
	for doctype in TARGET_DOCTYPES:
		ensure_coordinate_columns(doctype)
		backfill_coordinates(doctype)


def ensure_coordinate_columns(doctype: str) -> None:
	for fieldname in COORDINATE_FIELDS:
		if not frappe.db.has_column(doctype, fieldname):
			add_column(doctype, fieldname, "Float", precision=6)


def backfill_coordinates(doctype: str) -> None:
	if not frappe.db.has_column(doctype, "location"):
		return

	rows = frappe.db.sql(
		f"""
		SELECT name, location
		FROM `tab{doctype}`
		WHERE COALESCE(location, '') != ''
		  AND (latitude IS NULL OR longitude IS NULL)
		""",
		as_dict=True,
	)
	for row in rows:
		coordinates = parse_legacy_location(row.location)
		if not coordinates:
			continue

		latitude, longitude = coordinates
		frappe.db.set_value(
			doctype,
			row.name,
			{"latitude": latitude, "longitude": longitude},
			update_modified=False,
		)


def parse_legacy_location(location: str | dict[str, Any] | None) -> tuple[float, float] | None:
	if not location:
		return None

	try:
		payload = json.loads(location) if isinstance(location, str) else location
	except (TypeError, ValueError):
		return None

	features = payload.get("features") or []
	if not features:
		return None

	geometry = (features[0] or {}).get("geometry") or {}
	coordinates = geometry.get("coordinates") or []
	if len(coordinates) < 2:
		return None

	try:
		longitude = float(coordinates[0])
		latitude = float(coordinates[1])
	except (TypeError, ValueError):
		return None

	return latitude, longitude
