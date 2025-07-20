const map = L.map('map').setView([48.1374, 11.5755], 13);
//L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
L.tileLayer('https://api.maptiler.com/maps/basic/{z}/{x}/{y}.png?key=8S0Zpo1HRqDNrMV7HseO', {
  attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);






let streetSegments = [];// extracting all segments and storing them in an array
let streetsLoaded = false;



fetch('data/streets.geojson')  // fetching open steetmap streets as geojson
  .then(res => res.json())
  .then(data => {
    streetSegments = data.features.map((feature, i) => {
      return {
        id: i,
        coords: feature.geometry.coordinates.map(c => [c[1], c[0]]),
        properties: feature.properties,
        values: []
      };
    });
    
      // Optional: visualize streets immediately
    streetSegments.forEach(seg => {
      L.polyline(seg.coords, {
        color: "#999",
        weight: 2, 
        opacity: 0,
      }).addTo(map);
    });

    streetsLoaded = true;
  });


flatpickr("#startTime", { enableTime: true, dateFormat: "Y-m-d\\TH:i:S\\Z" });
flatpickr("#endTime", { enableTime: true, dateFormat: "Y-m-d\\TH:i:S\\Z" });

async function fetchObservations(id, start, end, includeLocation = false) {
  const startISO = new Date(start).toISOString();
  const endISO = new Date(end).toISOString();

  let url = `${CONFIG.baseUrl}/Datastreams(${id})/Observations?` +
            `$filter=during(phenomenonTime,${startISO}/${endISO})` +
            `&$orderby=phenomenonTime`;

  if (includeLocation) url += `&$expand=FeatureOfInterest`;

  let data = [];
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed for Datastream ${id}`);
    const json = await res.json();
    data = data.concat(json.value);
    url = json['@iot.nextLink'];  // pagination support
  }

  return data;
}

let drawnSegments = [];
function clearDrawnSegments() {
  drawnSegments.forEach(line => map.removeLayer(line));
  drawnSegments = [];
}

async function loadData() {
  if (!streetsLoaded) {
  alert("Streets are still loading. Please wait a moment.");
  return;
}
clearDrawnSegments(); // remove old visualizations

  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;
  const colorBy = document.getElementById('colorBy').value;

  if (!start || !end) {
    alert("Please select start and end times.");
    return;
  }

  map.eachLayer(layer => {
  if (layer instanceof L.Polyline && !(layer instanceof L.TileLayer)) {
    map.removeLayer(layer);
  }
});

  const [gpsData, rmsData, cciData, speedData] = await Promise.all([
    fetchObservations(CONFIG.datastreams.gps, start, end, true),
    fetchObservations(CONFIG.datastreams.rms, start, end),
    fetchObservations(CONFIG.datastreams.cci, start, end),
    fetchObservations(CONFIG.datastreams.speed, start, end),
  ]);

  console.log("GPS:", gpsData.length);
  console.log("RMS:", rmsData.length);
  console.log("CCI:", cciData.length);
  console.log("Speed:", speedData.length);

  const rmsIndex = buildTimeIndex(rmsData);
  const cciIndex = buildTimeIndex(cciData);
  const speedIndex = buildTimeIndex(speedData);

  const joined = gpsData.map(gps => {
    const t = gps.phenomenonTime;
    const coord = [gps.result.longitude, gps.result.latitude];

    return {
      time: t,
      lat: coord[1],
      lon: coord[0],
      rms: findClosestInIndex(rmsIndex, t),
      cci: findClosestInIndex(cciIndex, t),
      speed: findClosestInIndex(speedIndex, t)
    };
  });
  const viewMode = document.getElementById("viewMode").value;

if (viewMode === "points") {
  joined.forEach(pt => {
    if (pt.lat && pt.lon && pt.rms !== undefined && pt.cci !== undefined) {
      const value = colorBy === 'rms' ? pt.rms : pt.cci;
      const color = colorBy === 'rms' ? getColorForRMS(value) : getColorForCCI(value);

      const popup = `
        <b>Time:</b> ${pt.time}<br>
        <b>RMS:</b> ${pt.rms}<br>
        <b>CCI:</b> ${pt.cci}<br>
        <b>Speed:</b> ${pt.speed}
      `;

      L.circleMarker([pt.lat, pt.lon], {
        radius: 2,
        color: color,
        fillOpacity: 0.7
      }).addTo(map).bindPopup(popup);
    }
  });
}

else if (viewMode === "lines") {
 
streetSegments.forEach(s => s.values = []);
  
  // Assign sensor values to nearest street segments
  joined.forEach(pt => {
    if (pt.lat && pt.lon && pt[colorBy] !== undefined) {
      const nearest = findNearestSegment(pt.lat, pt.lon);
      if (nearest) nearest.values.push(pt[colorBy]);
    }
  });
  
  // Visualize segments with assigned average values
  streetSegments.forEach(seg => {
    if (seg.values.length > 0) {
      const avg = seg.values.reduce((a, b) => a + b) / seg.values.length;
      const color = colorBy === 'rms' ? getColorForRMS(avg) : getColorForCCI(avg);
  
      const poly = L.polyline(seg.coords, {
        color: color,
        weight: 5,
        opacity: 0.9
      }).addTo(map);
      drawnSegments.push(poly);
    }
  });     
  
  }
  updateLegend(colorBy);
  
}

function findClosestMatch(data, targetTimeISO, maxDeltaSec = 2) {
  const targetTime = new Date(targetTimeISO).getTime();
  let closest = null;
  let minDiff = Infinity;

  for (const item of data) {
    const time = new Date(item.phenomenonTime).getTime();
    const diff = Math.abs(targetTime - time) / 1000;
    if (diff < minDiff && diff <= maxDeltaSec) {
      closest = item;
      minDiff = diff;
    }
  }

  return closest?.result;
}

function interpolateSegment(a, b, metric, steps = 10) {
  const segments = [];

  for (let i = 0; i < steps; i++) {
    const t1 = i / steps;
    const t2 = (i + 1) / steps;

    const lat1 = a.lat + t1 * (b.lat - a.lat);
    const lon1 = a.lon + t1 * (b.lon - a.lon);
    const lat2 = a.lat + t2 * (b.lat - a.lat);
    const lon2 = a.lon + t2 * (b.lon - a.lon);

    const val1 = a[metric] + t1 * (b[metric] - a[metric]);
    const val2 = a[metric] + t2 * (b[metric] - a[metric]);
    const avg = (val1 + val2) / 2;

    segments.push({
      latlngs: [[lat1, lon1], [lat2, lon2]],
      value: avg
    });
  }

  return segments;
}




//create legend for RMS and CCI
let legendControl;

function updateLegend(metric) {
  if (legendControl) {
    legendControl.remove();
  }

  legendControl = L.control({ position: "bottomright" });

  legendControl.onAdd = function () {
    const div = L.DomUtil.create("div", "info legend");

    let grades, getColor, label;

    if (metric.toLowerCase() === "rms") {
      grades = [0.0, 0.315, 0.5, 0.63, 0.8];
      getColor = getColorForRMS;
      label = "RMS (m/s²)";
    } else if (metric.toLowerCase() === "cci") {
      grades = [5, 4, 3, 2, 1];  // From most comfortable to least
      getColor = getColorForCCI;
      label = "CCI (Comfort Cycling Index)";
    }

    div.innerHTML = `<strong>${label}</strong><br>`;
    for (let i = 0; i < grades.length; i++) {
        const g = grades[i];
         description = "";

  if (metric.toLowerCase() === "rms") {
  const to = grades[i + 1];

  description =
    g === 0.0 ? "Comfortable" :
    g === 0.315 ? "A little uncomfortable" :
    g === 0.5 ? "Fairly uncomfortable" :
    g === 0.63 ? "Uncomfortable" :
    g === 0.8 ? "Very uncomfortable" :
    `${g}+`;

  const rangeLabel = to ? `${g}–${to}` : `${g}+`;
    div.innerHTML +=
      `<i style="background:${getColor(g)}"></i> ${rangeLabel}: ${description}<br>`;
}

else if (metric.toLowerCase() === "cci") {
    description =
      g === 5 ? "Very comfortable" :
      g === 4 ? "Comfortable" :
      g === 3 ? "Slightly uncomfortable" :
      g === 2 ? "Uncomfortable" :
                "Extremely uncomfortable";
  
  
    div.innerHTML +=
    `<i style="background:${getColor(g)}"></i> ${description}<br>`;
  }



}

    return div;
  };

  legendControl.addTo(map);
}

function getColorForRMS(d) {
  return d >= 0.8   ? "#d73027" :  
         d >= 0.63  ? "#fc8d59" :  
         d >= 0.5   ? "#fee08b" :  
         d >= 0.315 ? "#4daf4a" :
                      "#216e39" ;
}
 
function getColorForCCI(d) {
  return d === 5 ? "#caf0f8" :  // very comfortable - dark green
         d === 4 ? "#90e0ef" :  // comfortable - green
         d === 3 ? "#00b4d8" :  // slightly uncomfortable - yellow
         d === 2 ? "#0077b6" :  // uncomfortable - orange
                   "#03045e" ;   // extremely uncomfortable - red
}


document.getElementById("colorBy").addEventListener("change", function () {
  const selected = this.value;
  updateLegend(selected);
});

// initialize legend based on default dropdown value
updateLegend(document.getElementById("colorBy").value);
function buildTimeIndex(data) {
  const map = new Map();
  for (const item of data) {
    const time = new Date(item.phenomenonTime).getTime();
    map.set(time, item.result);
  }
  return map;
}

function findClosestInIndex(indexMap, targetISO, maxDeltaSec = 2) {
  const targetTime = new Date(targetISO).getTime();
  let closestTime = null;
  let closestResult = null;
  let minDiff = Infinity;

  for (let [time, result] of indexMap) {
    const diff = Math.abs(targetTime - time) / 1000;
    if (diff < minDiff && diff <= maxDeltaSec) {
      closestTime = time;
      closestResult = result;
      minDiff = diff;
    }
  }

  return closestResult;
}

function findNearestSegment(lat, lon) {
  let minDist = Infinity;
  let closest = null;

  streetSegments.forEach(seg => {
    for (let i = 0; i < seg.coords.length - 1; i++) {
      const dist = pointToSegmentDistance([lat, lon], seg.coords[i], seg.coords[i + 1]);
      if (dist < minDist) {
        minDist = dist;
        closest = seg;
      }
    }
  });

  return closest;
}

function pointToSegmentDistance(p, a, b) {
  const latlngToXY = ([lat, lng]) => [lng, lat];

  const [px, py] = latlngToXY(p);
  const [ax, ay] = latlngToXY(a);
  const [bx, by] = latlngToXY(b);

  const dx = bx - ax;
  const dy = by - ay;

  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clampT = Math.max(0, Math.min(1, t));

  const closestX = ax + clampT * dx;
  const closestY = ay + clampT * dy;

  const dX = px - closestX;
  const dY = py - closestY;
  return Math.sqrt(dX * dX + dY * dY);
}







