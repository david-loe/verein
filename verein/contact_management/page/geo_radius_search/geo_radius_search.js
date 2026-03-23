frappe.provide("verein.contact_management");

const FALLBACK_MAP_DEFAULTS = {
	latitude: 51.1657,
	longitude: 10.4515,
	zoom: 6,
};

frappe.pages["geo-radius-search"].on_page_load = function (wrapper) {
	if (!wrapper.geoRadiusSearch) {
		wrapper.geoRadiusSearch = new verein.contact_management.GeoRadiusSearchPage(wrapper);
	}
};

frappe.pages["geo-radius-search"].refresh = function (wrapper) {
	wrapper.geoRadiusSearch?.refresh();
};

verein.contact_management.GeoRadiusSearchPage = class GeoRadiusSearchPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.coordinates = null;
		this.map = null;
		this.marker = null;
		this.radiusCircle = null;
		this.resultLayer = null;
		this.filterGroup = null;
		this.filterGroupRequestId = 0;
		this.sourceContext = null;
		this.selectedLocationLabel = null;
		this.mapDefaults = { ...FALLBACK_MAP_DEFAULTS };
		this.mapDefaultsPromise = this.load_map_defaults();
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Geo Radius Search"),
			single_column: true,
		});
		this.inject_styles();
		this.make_controls();
		this.make_layout();
		this.refresh();
	}

	inject_styles() {
		if (document.getElementById("geo-radius-search-styles")) {
			return;
		}

		$(`<style id="geo-radius-search-styles">
			.geo-radius-search-grid {
				display: grid;
				grid-template-columns: minmax(360px, 0.95fr) minmax(360px, 1.05fr);
				gap: 1.25rem;
				align-items: start;
			}

			.geo-radius-settings-card .card-body,
			.geo-radius-results-card .card-body {
				display: flex;
				flex-direction: column;
				gap: 1rem;
			}

			.geo-radius-panel-header {
				display: flex;
				justify-content: space-between;
				align-items: flex-start;
				gap: 1rem;
			}

			.geo-panel-title {
				margin: 0;
			}

			.geo-panel-subtitle {
				font-size: 0.875rem;
				color: var(--text-muted);
				margin-top: 0.25rem;
			}

			.geo-origin-search-row {
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				gap: 0.75rem;
				align-items: center;
			}

			.geo-field-label {
				font-size: 0.72rem;
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
				color: var(--text-muted);
				margin-bottom: 0.4rem;
			}

			.geo-compact-grid {
				display: grid;
				grid-template-columns: minmax(150px, 0.9fr) minmax(110px, 0.55fr) minmax(0, 1fr) minmax(0, 1fr);
				gap: 0.9rem 1rem;
				align-items: start;
			}

			.geo-radius-search .form-group.frappe-control {
				width: 100%;
				max-width: none;
				margin-bottom: 0;
			}

			.geo-radius-search .form-group.frappe-control .control-label,
			.geo-radius-search .form-group.frappe-control .help-box {
				display: none !important;
			}

			.geo-radius-search .multiselect-list,
			.geo-radius-search .multiselect-list .form-control,
			.geo-radius-search .frappe-control select,
			.geo-radius-search .frappe-control input {
				width: 100%;
			}

			.geo-radius-search .geocode-location {
				white-space: nowrap;
			}

			.geo-radius-search .radius-search-info {
				font-size: 0.875rem;
				color: var(--text-muted);
				margin: 0;
			}

			.geo-radius-search .selected-coordinates {
				padding: 0.5rem 0.7rem;
				border: 1px solid var(--border-color);
				border-radius: var(--border-radius-md);
				background: var(--subtle-accent);
			}

			.geo-radius-search .selected-coordinates.is-empty {
				display: none;
			}

			.geo-radius-search .geocode-results {
				max-height: 11rem;
				overflow: auto;
			}

			.geo-radius-search .additional-filters {
				border-top: 1px solid var(--border-color);
				padding-top: 0.9rem;
			}

			.geo-radius-search .additional-filters summary {
				cursor: pointer;
				font-weight: 600;
				color: var(--text-muted);
			}

			.geo-radius-search .additional-filters[open] summary {
				margin-bottom: 0.75rem;
			}

			.geo-radius-search .geo-radius-right {
				position: sticky;
				top: 1rem;
			}

			.geo-radius-search .radius-search-map {
				width: 100%;
				aspect-ratio: 1 / 1;
				min-height: 420px;
			}

			.geo-radius-search .results-toolbar {
				display: flex;
				justify-content: space-between;
				align-items: center;
				gap: 1rem;
				flex-wrap: wrap;
			}

			.geo-radius-search .table-responsive {
				margin-bottom: 0;
			}

			@media (max-width: 1399px) {
				.geo-compact-grid {
					grid-template-columns: repeat(2, minmax(0, 1fr));
				}
			}

			@media (max-width: 991px) {
				.geo-radius-search-grid {
					grid-template-columns: 1fr;
				}

				.geo-radius-search .geo-radius-right {
					position: static;
				}
			}

			@media (max-width: 767px) {
				.geo-origin-search-row,
				.geo-compact-grid {
					grid-template-columns: 1fr;
				}
			}
		</style>`).appendTo(document.head);
	}

	make_controls() {
		this.searchDoctypeField = this.page.add_field({
			fieldname: "search_doctype",
			label: __("Search For"),
			fieldtype: "Select",
			options: "Supporter\nNetwork",
			default: "Supporter",
			change: () => this.on_doctype_change(),
		});
		this.radiusField = this.page.add_field({
			fieldname: "radius_km",
			label: __("Radius (km)"),
			fieldtype: "Int",
			default: 25,
			reqd: 1,
			change: () => this.update_radius_circle(),
		});
		this.networkField = this.page.add_field({
			fieldname: "networks",
			label: __("Networks"),
			fieldtype: "MultiSelectList",
			options: "Network",
			get_data: (txt) => frappe.db.get_link_options("Network", txt),
		});
		this.experienceField = this.page.add_field({
			fieldname: "experiences",
			label: __("Experiences"),
			fieldtype: "MultiSelectList",
			options: "Experience",
			get_data: (txt) => frappe.db.get_link_options("Experience", txt),
		});
		this.networkTypeField = this.page.add_field({
			fieldname: "network_type",
			label: __("Network Type"),
			fieldtype: "Link",
			options: "Network Type",
			get_query: () => ({
				filters: {},
			}),
		});

		this.page.set_primary_action(__("Search"), () => this.search());
	}

	make_layout() {
		this.content = $(`
			<div class="geo-radius-search">
				<div class="geo-radius-search-grid">
					<div class="geo-radius-left">
						<div class="card mb-3 geo-radius-settings-card">
							<div class="card-body">
								<div class="geo-radius-panel-header">
									<div>
										<h4 class="geo-panel-title">${__("Search Settings")}</h4>
										<div class="geo-panel-subtitle">
											${__("Start point, radius, and optional filters in one compact view.")}
										</div>
									</div>
								</div>

								<div class="geo-origin-block">
									<div class="geo-field-label">${__("Start Point")}</div>
									<div class="radius-search-info"></div>
									<div class="geo-origin-search-row">
										<input
											type="text"
											class="form-control location-query"
											placeholder="${frappe.utils.escape_html(__("Enter a place or set a pin on the map"))}"
										/>
										<button class="btn btn-default geocode-location">${__("Find Place")}</button>
									</div>
									<div class="selected-coordinates small is-empty"></div>
									<div class="geocode-results"></div>
								</div>

								<div class="geo-compact-grid">
									<div class="geo-field-shell">
										<div class="geo-field-label">${__("Search For")}</div>
										<div class="search-doctype-control"></div>
									</div>
									<div class="geo-field-shell">
										<div class="geo-field-label">${__("Radius")}</div>
										<div class="radius-control"></div>
									</div>
									<div class="geo-field-shell network-field-shell">
										<div class="geo-field-label">${__("Networks")}</div>
										<div class="network-control"></div>
									</div>
									<div class="geo-field-shell experience-field-shell">
										<div class="geo-field-label">${__("Experiences")}</div>
										<div class="experience-control"></div>
									</div>
									<div class="geo-field-shell network-type-field-shell">
										<div class="geo-field-label">${__("Network Type")}</div>
										<div class="network-type-control"></div>
									</div>
								</div>

								<details class="additional-filters">
									<summary>${__("More Filters")}</summary>
									<div class="radius-search-filters"></div>
								</details>
							</div>
						</div>

						<div class="card geo-radius-results-card">
							<div class="card-body">
								<div class="results-toolbar">
									<div>
										<h4 class="mb-1">${__("Results")}</h4>
										<div class="results-summary text-muted small"></div>
									</div>
									<button class="btn btn-default export-results">${__("Export Excel")}</button>
								</div>
								<div class="radius-search-results"></div>
							</div>
						</div>
					</div>

					<div class="geo-radius-right">
						<div class="card">
							<div class="card-body">
								<div class="radius-search-map border rounded"></div>
							</div>
						</div>
					</div>
				</div>
			</div>
		`).appendTo(this.page.main);

		this.info = this.content.find(".radius-search-info");
		this.searchDoctypeWrapper = this.content.find(".search-doctype-control");
		this.radiusWrapper = this.content.find(".radius-control");
		this.networkWrapper = this.content.find(".network-control");
		this.experienceWrapper = this.content.find(".experience-control");
		this.networkTypeWrapper = this.content.find(".network-type-control");
		this.filtersWrapper = this.content.find(".radius-search-filters");
		this.resultsWrapper = this.content.find(".radius-search-results");
		this.resultsSummaryWrapper = this.content.find(".results-summary");
		this.mapWrapper = this.content.find(".radius-search-map");
		this.queryInput = this.content.find(".location-query");
		this.findLocationButton = this.content.find(".geocode-location");
		this.exportButton = this.content.find(".export-results");
		this.geocodeResultsWrapper = this.content.find(".geocode-results");
		this.selectedCoordinatesWrapper = this.content.find(".selected-coordinates");
		this.additionalFiltersDetails = this.content.find(".additional-filters");
		this.networkFieldShell = this.content.find(".network-field-shell");
		this.experienceFieldShell = this.content.find(".experience-field-shell");
		this.networkTypeFieldShell = this.content.find(".network-type-field-shell");

		this.move_control(this.searchDoctypeField, this.searchDoctypeWrapper);
		this.move_control(this.radiusField, this.radiusWrapper);
		this.move_control(this.networkField, this.networkWrapper);
		this.move_control(this.experienceField, this.experienceWrapper);
		this.move_control(this.networkTypeField, this.networkTypeWrapper);

		this.findLocationButton.on("click", () => this.geocode_location());
		this.exportButton.on("click", () => this.export_results());
		this.queryInput.on("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.geocode_location();
			}
		});
		this.geocodeResultsWrapper.on("click", ".select-geocode-result", (event) => {
			const button = $(event.currentTarget);
			this.select_geocode_result({
				display_name: button.attr("data-display-name"),
				lat: button.attr("data-latitude"),
				lon: button.attr("data-longitude"),
			});
		});

		this.update_info();
		this.init_map();
		this.on_doctype_change();
	}

	move_control(control, container) {
		$(control.wrapper).appendTo(container);
	}

	async load_map_defaults() {
		try {
			const { message } = await frappe.call({
				method: "verein.contact_management.doctype.geo_settings.geo_settings.get_map_defaults",
			});
			this.mapDefaults = {
				latitude: Number(message?.latitude || FALLBACK_MAP_DEFAULTS.latitude),
				longitude: Number(message?.longitude || FALLBACK_MAP_DEFAULTS.longitude),
				zoom: Number(message?.zoom || FALLBACK_MAP_DEFAULTS.zoom),
			};
		} catch (error) {
			console.error(error);
			this.mapDefaults = { ...FALLBACK_MAP_DEFAULTS };
		}
	}

	init_map() {
		if (this.map) {
			return;
		}

		const mapDefaults = frappe.utils.map_defaults || {};
		if (L?.Icon?.Default && mapDefaults.image_path) {
			L.Icon.Default.imagePath = mapDefaults.image_path;
		}

		this.map = L.map(this.mapWrapper.get(0)).setView(
			[this.mapDefaults.latitude, this.mapDefaults.longitude],
			this.mapDefaults.zoom
		);
		this.resultLayer = L.layerGroup().addTo(this.map);

		this.streetLayer = L.tileLayer(
			mapDefaults.tiles?.default_tile?.url || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
			mapDefaults.tiles?.default_tile?.options || {
				attribution:
					'&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors',
			}
		);
		this.streetLayer.addTo(this.map);

		if (mapDefaults.tiles?.satellite_tile?.url) {
			this.satelliteLayer = L.tileLayer(
				mapDefaults.tiles.satellite_tile.url,
				mapDefaults.tiles.satellite_tile.options || {}
			);
			L.control
				.layers(
					{
						[__("Default")]: this.streetLayer,
						[__("Satellite")]: this.satelliteLayer,
					},
					{}
				)
				.addTo(this.map);
		}

		this.map.on("click", (event) => {
			this.selectedLocationLabel = __("Manually placed pin");
			this.set_coordinates(event.latlng.lat, event.latlng.lng, { center: false });
		});

		setTimeout(() => this.map.invalidateSize(), 100);
	}

	async on_doctype_change() {
		const requestId = ++this.filterGroupRequestId;
		const searchDoctype = this.searchDoctypeField.get_value();
		this.toggle_special_filters(searchDoctype === "Supporter");

		this.filtersWrapper.empty();
		this.filterGroup = null;
		await frappe.model.with_doctype(searchDoctype);
		if (requestId !== this.filterGroupRequestId) {
			return;
		}

		this.filtersWrapper.empty();
		this.filterGroup = new frappe.ui.FilterGroup({
			parent: this.filtersWrapper,
			doctype: searchDoctype,
			on_change: () => {},
		});
	}

	toggle_special_filters(showSupporterFilters) {
		this.networkFieldShell.toggle(showSupporterFilters);
		this.experienceFieldShell.toggle(showSupporterFilters);
		this.networkTypeFieldShell.toggle(!showSupporterFilters);
		if (!showSupporterFilters) {
			this.networkField.set_value([]);
			this.experienceField.set_value([]);
			return;
		}

		this.networkTypeField.set_value("");
	}

	async refresh() {
		await this.mapDefaultsPromise;

		const routeOptions = frappe.route_options;
		if (!routeOptions) {
			this.set_default_map_view();
			setTimeout(() => this.map?.invalidateSize(), 50);
			return;
		}

		frappe.route_options = null;
		this.searchDoctypeField.set_value(routeOptions.search_doctype || "Supporter");
		await this.on_doctype_change();
		this.radiusField.set_value(routeOptions.radius_km || 25);
		this.networkField.set_value(routeOptions.networks || (routeOptions.network ? [routeOptions.network] : []));
		this.experienceField.set_value(
			routeOptions.experiences || (routeOptions.experience ? [routeOptions.experience] : [])
		);
		this.networkTypeField.set_value(routeOptions.network_type || "");

		this.sourceContext =
			routeOptions.source_doctype && routeOptions.source_name
				? __("Start point: {0} {1}", [routeOptions.source_doctype, routeOptions.source_name])
				: null;

		if (routeOptions.query) {
			this.queryInput.val(routeOptions.query);
		}

		if (routeOptions.latitude && routeOptions.longitude) {
			this.selectedLocationLabel =
				this.sourceContext || routeOptions.location_label || __("Preset start point");
			this.set_coordinates(routeOptions.latitude, routeOptions.longitude);
			this.search();
		} else {
			this.set_default_map_view();
			this.update_info();
		}

		setTimeout(() => this.map?.invalidateSize(), 50);
	}

	set_default_map_view() {
		if (!this.map || this.coordinates) {
			return;
		}

		this.map.setView([this.mapDefaults.latitude, this.mapDefaults.longitude], this.mapDefaults.zoom);
	}

	async geocode_location() {
		const query = cstr(this.queryInput.val()).trim();
		if (!query) {
			frappe.msgprint(__("Please enter a place or address first."));
			return;
		}

		this.geocodeResultsWrapper.html(`<p class="text-muted mb-0">${__("Searching for place...")}</p>`);

		try {
			const params = new URLSearchParams({
				q: query,
				format: "jsonv2",
				limit: "5",
				addressdetails: "1",
				"accept-language": frappe.boot.lang || "de",
			});
			const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
			if (!response.ok) {
				throw new Error(`Geocoding request failed with status ${response.status}`);
			}

			const results = await response.json();
			this.render_geocode_results(results || []);
		} catch (error) {
			console.error(error);
			this.geocodeResultsWrapper.html(
				`<p class="text-danger mb-0">${__("Could not resolve the place.")}</p>`
			);
		}
	}

	render_geocode_results(results) {
		if (!results.length) {
			this.geocodeResultsWrapper.html(
				`<p class="text-muted mb-0">${__("No matching places found.")}</p>`
			);
			return;
		}

		const rows = results
			.map((result) => {
				const displayName = frappe.utils.escape_html(result.display_name || "");
				return `
					<button
						type="button"
						class="btn btn-default btn-sm d-block text-start w-100 mb-2 select-geocode-result"
						data-display-name="${frappe.utils.escape_html(result.display_name || "")}"
						data-latitude="${frappe.utils.escape_html(result.lat || "")}"
						data-longitude="${frappe.utils.escape_html(result.lon || "")}"
					>
						${displayName}
					</button>`;
			})
			.join("");

		this.geocodeResultsWrapper.html(rows);
	}

	select_geocode_result(result) {
		this.queryInput.val(result.display_name || "");
		this.selectedLocationLabel = result.display_name || __("Selected place");
		this.set_coordinates(result.lat, result.lon);
		this.geocodeResultsWrapper.empty();
	}

	set_coordinates(latitude, longitude, options = {}) {
		const parsedLatitude = Number(latitude);
		const parsedLongitude = Number(longitude);
		if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
			return;
		}

		this.coordinates = {
			latitude: parsedLatitude,
			longitude: parsedLongitude,
		};

		if (!this.marker) {
			this.marker = L.marker([parsedLatitude, parsedLongitude], { draggable: true }).addTo(this.map);
			this.marker.on("dragend", (event) => {
				const markerLatLng = event.target.getLatLng();
				this.selectedLocationLabel = __("Manually moved pin");
				this.set_coordinates(markerLatLng.lat, markerLatLng.lng);
			});
		} else {
			this.marker.setLatLng([parsedLatitude, parsedLongitude]);
		}

		this.update_radius_circle(options);
		this.render_selected_coordinates();
		this.update_info();
	}

	update_radius_circle(options = {}) {
		if (!this.map) {
			return;
		}

		const radiusKm = Number(this.radiusField.get_value());
		if (!this.coordinates || !Number.isInteger(radiusKm) || radiusKm <= 0) {
			if (this.radiusCircle) {
				this.map.removeLayer(this.radiusCircle);
				this.radiusCircle = null;
			}
			return;
		}

		const latLng = [this.coordinates.latitude, this.coordinates.longitude];
		if (!this.radiusCircle) {
			this.radiusCircle = L.circle(latLng, {
				radius: radiusKm * 1000,
				color: "#1f6feb",
				fillColor: "#1f6feb",
				fillOpacity: 0.08,
				weight: 2,
			}).addTo(this.map);
		} else {
			this.radiusCircle.setLatLng(latLng);
			this.radiusCircle.setRadius(radiusKm * 1000);
		}

		if (options.fitToRadius !== false) {
			this.fit_map_to_radius();
		}
	}

	fit_map_to_radius() {
		if (!this.map || !this.radiusCircle) {
			return;
		}

		this.map.fitBounds(this.radiusCircle.getBounds(), {
			padding: [32, 32],
			maxZoom: 12,
		});
	}

	clear_result_markers() {
		this.resultLayer?.clearLayers();
	}

	render_selected_coordinates() {
		if (!this.coordinates) {
			this.selectedCoordinatesWrapper.addClass("is-empty");
			this.selectedCoordinatesWrapper.empty();
			return;
		}

		this.selectedCoordinatesWrapper.removeClass("is-empty");
		const label = this.selectedLocationLabel
			? `<strong>${frappe.utils.escape_html(this.selectedLocationLabel)}</strong><br>`
			: "";
		this.selectedCoordinatesWrapper.html(
			`${label}${__("Coordinates")}: ${this.coordinates.latitude.toFixed(6)}, ${this.coordinates.longitude.toFixed(6)}`
		);
	}

	update_info() {
		if (this.selectedLocationLabel) {
			this.info.text(__("Selected start point: {0}", [this.selectedLocationLabel]));
			return;
		}

		if (this.sourceContext) {
			this.info.text(this.sourceContext);
			return;
		}

		this.info.text(__("Search for a place or set the start point directly on the map."));
	}

	search() {
		const radius = Number(this.radiusField.get_value());

		if (!this.coordinates) {
			frappe.msgprint(__("Please set a start point first using place search or a map pin."));
			return;
		}

		if (!Number.isInteger(radius) || radius <= 0) {
			frappe.msgprint(__("Radius must be a whole number greater than 0."));
			return;
		}

		this.resultsWrapper.html(`<p class="text-muted">${__("Searching...")}</p>`);
		this.clear_result_markers();
		frappe.call({
			method: "verein.contact_management.page.geo_radius_search.geo_radius_search.search_records",
			args: this.get_request_args(),
			callback: ({ message }) => this.render_results(message || []),
		});
	}

	export_results() {
		if (!this.coordinates) {
			frappe.msgprint(__("Please set a start point before exporting."));
			return;
		}

		open_url_post(
			"/api/method/verein.contact_management.page.geo_radius_search.geo_radius_search.export_records",
			this.get_request_args()
		);
	}

	get_request_args() {
		return {
			search_doctype: this.searchDoctypeField.get_value(),
			latitude: this.coordinates?.latitude,
			longitude: this.coordinates?.longitude,
			radius_km: Number(this.radiusField.get_value()),
			filters: JSON.stringify(this.filterGroup?.get_filters() || []),
			networks: JSON.stringify(this.networkField.get_value() || []),
			experiences: JSON.stringify(this.experienceField.get_value() || []),
			network_type: this.networkTypeField.get_value(),
		};
	}

	render_results(results) {
		this.resultsSummaryWrapper.text(
			results.length ? __("{0} results", [results.length]) : __("No results")
		);
		this.render_result_markers(results);

		if (!results.length) {
			this.resultsWrapper.html(`<p class="text-muted mb-0">${__("No results within the radius.")}</p>`);
			return;
		}

		const isSupporterSearch = this.searchDoctypeField.get_value() === "Supporter";
		const searchDoctype = this.searchDoctypeField.get_value();
		const doctypeRoute = frappe.router.slug(searchDoctype);
		const reasonHeader = isSupporterSearch ? `<th>${__("Matched By")}</th>` : "";
		const rows = results
			.map((result) => {
				const secondaryValues = (result.secondary_values || [])
					.map((value) => frappe.utils.escape_html(String(value)))
					.join(" · ");
				const matchReasons = isSupporterSearch ? this.render_match_reasons(result) : "";
				return `
					<tr>
						<td>
							<a href="/app/${doctypeRoute}/${encodeURIComponent(result.name)}">
								${frappe.utils.escape_html(result.title || result.name)}
							</a>
							${secondaryValues ? `<div class="small text-muted mt-1">${secondaryValues}</div>` : ""}
						</td>
						${isSupporterSearch ? `<td>${matchReasons}</td>` : ""}
						<td class="text-end">${frappe.utils.escape_html(format_distance(result.distance_km))}</td>
					</tr>`;
			})
			.join("");

		this.resultsWrapper.html(`
			<div class="table-responsive">
				<table class="table table-hover align-middle">
					<thead>
						<tr>
							<th>${__("Result")}</th>
							${reasonHeader}
							<th class="text-end">${__("Distance")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		`);
	}

	render_result_markers(results) {
		this.clear_result_markers();
		if (!this.map || !this.resultLayer) {
			return;
		}

		results.forEach((result) => {
			if (!Number.isFinite(Number(result.latitude)) || !Number.isFinite(Number(result.longitude))) {
				return;
			}

			L.circleMarker([Number(result.latitude), Number(result.longitude)], {
				radius: 7,
				color: "#c2410c",
				fillColor: "#fb923c",
				fillOpacity: 0.95,
				weight: 2,
			})
				.bindPopup(this.build_result_popup(result))
				.addTo(this.resultLayer);
		});
	}

	build_result_popup(result) {
		const searchDoctype = this.searchDoctypeField.get_value();
		const doctypeRoute = frappe.router.slug(searchDoctype);
		const lines = [
			`<div><a href="/app/${doctypeRoute}/${encodeURIComponent(result.name)}"><strong>${frappe.utils.escape_html(result.title || result.name || "")}</strong></a></div>`,
			`<div>${frappe.utils.escape_html(format_distance(result.distance_km))}</div>`,
		];
		if ((result.secondary_values || []).length) {
			lines.push(
				`<div class="text-muted">${frappe.utils.escape_html(result.secondary_values.join(" · "))}</div>`
			);
		}
		const matchReasons = this.render_match_reasons(result, { emptyLabel: "" });
		if (matchReasons) {
			lines.push(`<div class="mt-2">${matchReasons}</div>`);
		}

		return lines.join("");
	}

	render_match_reasons(result, options = {}) {
		const parts = [];
		if ((result.matched_networks || []).length) {
			parts.push(
				`<div><strong>${__("Network")}:</strong> ${frappe.utils.escape_html(
					result.matched_networks.join(", ")
				)}</div>`
			);
		}
		if ((result.matched_experiences || []).length) {
			parts.push(
				`<div><strong>${__("Experience")}:</strong> ${frappe.utils.escape_html(
					result.matched_experiences.join(", ")
				)}</div>`
			);
		}
		if (parts.length) {
			return parts.join("");
		}

		if (options.emptyLabel === "") {
			return "";
		}

		return `<span class="text-muted">${__("No filter match")}</span>`;
	}
};

function cstr(value) {
	return value == null ? "" : String(value);
}

function format_distance(distanceKm) {
	return `${Number(distanceKm || 0).toFixed(2)} km`;
}
