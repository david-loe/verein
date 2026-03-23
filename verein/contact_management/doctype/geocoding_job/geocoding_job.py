# Copyright (c) 2025, david-loe and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
import json
import requests, frappe
import time

@frappe.whitelist()
def run_job_async(doc: str):
    doc_data = frappe.parse_json(doc)
    doc_instance = frappe.get_doc("Geocoding Job", doc_data["name"])
    frappe.enqueue(doc_instance.run)
    frappe.msgprint("Geocoding-Job wurde in die Warteschlange gestellt.")


class GeocodingJob(Document):
    def run(self, settings: dict = {}):
        if not settings:
            settings = frappe.get_single("Geocoding API Settings")
        if settings.get("url") and settings.get("lat_param") and settings.get("lon_param"):
            supporter_doc = frappe.get_doc("Supporter", self.supporter)
            if not supporter_doc:
                self.update({"status": "Failed", "error_message": "Supporter not found"})
                self.save()
                return

            address_data = {
                "address_line_1": supporter_doc.address_line_1,
                "address_line_2": supporter_doc.address_line_2,
                "city": supporter_doc.city,
                "postal_code": supporter_doc.postal_code,
                "country": supporter_doc.country,
            }

            api_url = frappe.render_template(settings.url, address_data)

            try:
                app_name = frappe.get_hooks("app_name")[0]
                app_version = frappe.get_hooks("app_version")[0]
                site_url = frappe.utils.get_url()
                headers = {"User-Agent": f"{app_name}/{app_version} (+{site_url})", "Referer": site_url}
                if settings.headers:
                    headers.update(frappe.parse_json(settings.headers))

                response = requests.get(api_url, headers=headers)

                response.raise_for_status()
                data = response.json()

                lat = get_nested_value(data, settings.lat_param)
                lon = get_nested_value(data, settings.lon_param)
                if isinstance(lat, str):
                    lat = float(lat)
                if isinstance(lon, str):
                    lon = float(lon)
                if lat is None or lon is None:
                    raise ValueError(f"Coordinates could not be extracted from the response: {data}")

                geojson = json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "properties": {},
                                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                            }
                        ],
                    }
                )

                supporter_doc.db_set("location", geojson, update_modified=False, commit=True, notify=True)

                self.status = "Completed"
            except Exception as e:
                self.update({"status": "Failed", "error_message": str(e)})
                frappe.log_error(message=str(e), title="Geocoding Fehler")
            self.save()
            frappe.db.commit()


def get_nested_value(data, key_path):
    """
    Extrahiert einen Wert aus einem verschachtelten JSON-Dictionary oder einer Liste anhand eines
    dot-notation Pfads (z. B. "result.location.lat" oder "results.0.lat").
    """
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
    settings = frappe.get_single("Geocoding API Settings")
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
        WHERE status = 'Successfull'
        AND modified < DATE_SUB(NOW(), INTERVAL 1 WEEK)
        """
    )
