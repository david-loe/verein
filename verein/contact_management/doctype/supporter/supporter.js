frappe.ui.form.on("Supporter", {
	refresh(frm) {
		frm.set_query("spouse", () => ({
			filters: frm.doc.name ? { name: ["!=", frm.doc.name] } : {},
		}));
		render_geo_map_preview(frm);
	},
});

function has_geo_coordinates(doc) {
	return doc.latitude != null && doc.longitude != null;
}

function render_geo_map_preview(frm) {
	const field = frm.get_field("geo_map_preview");
	if (!field) {
		return;
	}

	ensure_geo_map_preview_styles();
	const wrapper = field.$wrapper;
	destroy_geo_map(wrapper);

	if (!has_geo_coordinates(frm.doc)) {
		wrapper.empty();
		return;
	}

	const mapId = `supporter-geo-map-${frappe.utils.get_random(10)}`;
	wrapper.html(`<div class="geo-doc-preview-map" id="${mapId}"></div>`);

	const map = L.map(mapId, {
		scrollWheelZoom: false,
		attributionControl: true,
	});
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		attribution: "&copy; OpenStreetMap contributors",
		maxZoom: 19,
	}).addTo(map);

	const latLng = [frm.doc.latitude, frm.doc.longitude];
	L.marker(latLng).addTo(map);
	map.setView(latLng, 13);
	wrapper.data("geoPreviewMap", map);

	setTimeout(() => map.invalidateSize(), 0);
}

function destroy_geo_map(wrapper) {
	const map = wrapper.data("geoPreviewMap");
	if (map) {
		map.remove();
		wrapper.removeData("geoPreviewMap");
	}
}

function ensure_geo_map_preview_styles() {
	if (document.getElementById("geo-doc-preview-styles")) {
		return;
	}

	$(`<style id="geo-doc-preview-styles">
		.geo-doc-preview-map {
			width: 100%;
			min-height: 280px;
			border-radius: var(--border-radius-md);
			overflow: hidden;
			border: 1px solid var(--border-color);
		}
	</style>`).appendTo(document.head);
}
