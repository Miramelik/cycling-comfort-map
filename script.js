const map = L.map('map').setView([48.1374, 11.5755], 13);
//L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
L.tileLayer('https://api.maptiler.com/maps/basic/{z}/{x}/{y}.png?key=8S0Zpo1HRqDNrMV7HseO', {
  attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const presets = {
  maxvorstadt: {
    bounds: [[48.13081, 11.55161], [48.15693, 11.58972]],
    start: "2025-07-17T20:04:00",
    end: "2025-07-17T21:42:00"
  },
  amhart: {
    bounds: [[48.18154, 11.55504], [48.21873, 11.59624]],
    start: "2025-07-14T23:42:00",
    end: "2025-07-15T01:15:00"
  },
  milbertshofen: {
    bounds: [[48.17570, 11.56328], [48.18909, 11.58817]],
    start: "2025-07-18T20:34:00",
    end: "2025-07-18T21:45:00"
  }
};





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

function localInputToUTCString(input) {
   // If input already ends with 'Z', treat it as UTC and return directly
  if (input.endsWith("Z")) return input;
  // Otherwise, convert local time to UTC
  const localDate = new Date(input);
  const tzOffset = localDate.getTimezoneOffset() * 60000;
  const utcDate = new Date(localDate.getTime() - tzOffset);
  return utcDate.toISOString();
}

flatpickr("#startTime", { enableTime: true, dateFormat: "Y-m-d\\TH:i:S" });
flatpickr("#endTime", { enableTime: true, dateFormat: "Y-m-d\\TH:i:S" });

async function fetchObservations(id, start, end, includeLocation = false) {
  const startISO = localInputToUTCString(start);
  const endISO = localInputToUTCString(end);




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


let pointMarkers = [];

async function loadData() {
  if (!streetsLoaded) {
  alert("Streets are still loading. Please wait a moment.");
  return;
}

clearDrawnSegments(); // remove old visualizations
pointMarkers.forEach(m => map.removeLayer(m));
pointMarkers = [];


const colorBy = document.getElementById('colorBy').value;

const startInput = document.getElementById('startTime');
const endInput = document.getElementById('endTime');

const start = startInput.value;
const end = endInput.value;

console.log("Start input:", start);
console.log("End input:", end);

const startTime = new Date(start);
const endTime = new Date(end);

console.log("Parsed StartTime:", startTime, "Valid?", !isNaN(startTime.getTime()));
console.log("Parsed EndTime:", endTime, "Valid?", !isNaN(endTime.getTime()));


// Validate
if (!start || !end || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
  alert("Please select both valid start and end times.");
  return;
}

  // Ensure start < end

if (startTime >= endTime) {
  alert("End time must be after start time.");
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

      const localTime = new Date(pt.time).toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      hour12: false
    });

      const popup = `
        <b>Time:</b> ${localTime}<br>
        <b>RMS:</b> ${pt.rms}<br>
        <b>Speed:</b> ${pt.speed}
      `;

      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: 2,
        color: color,
        fillOpacity: 0.7
      }).addTo(map).bindPopup(popup);

      pointMarkers.push(marker);
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
  
      const popup = `
        <b> ${colorBy.toUpperCase()}</b>: ${avg.toFixed(2)}<br>
        
      `;
      
      const poly = L.polyline(seg.coords, {
        color: color,
        weight: 5,
        opacity: 0.9,
        interactive: true
      }).addTo(map).bindPopup(popup);
      drawnSegments.push(poly);       
  
  }
  });
}

else if (viewMode === "rawlines") {
  // Draw direct point-to-point segments
  for (let i = 1; i < joined.length; i++) {
    const prev = joined[i - 1];
    const curr = joined[i];
    
    if (
      prev.lat && prev.lon && curr.lat && curr.lon &&
      curr[colorBy] !== undefined
    ) {
      const color = colorBy === 'rms' ? getColorForRMS(curr[colorBy]) : getColorForCCI(curr[colorBy]);

           
      const popup = `
        <b>RMS:</b> ${curr.rms}<br>
      `;


      const line = L.polyline([[prev.lat, prev.lon], [curr.lat, curr.lon]], {
        color: color,
        weight: 4,
        opacity: 0.9
      }).addTo(map).bindPopup(popup);

      drawnSegments.push(line);

      
    }
  }
}
      



  updateLegend(colorBy);
}



  


function toInputLocalString(dateStr) {
  const d = new Date(dateStr);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return d.toISOString().slice(0, 16) + 'Z';
}


async function loadPreset(regionKey) {
  const preset = presets[regionKey];
  if (!preset) return;

  // ✅ Convert UTC to local time format for input fields
  document.getElementById("startTime").value = toInputLocalString(preset.start);
  document.getElementById("endTime").value = toInputLocalString(preset.end);

  // Zoom to area
  map.fitBounds(preset.bounds);

  loadData(); // Ensure the data is loaded after preset
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
      grades = [0.0, 0.315, 0.5, 0.8, 1.25, 2.0];
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
    g === 0.8 ? "Uncomfortable" :
    g === 1.25 ? "Very uncomfortable" :
    g === 2 ? "Extremely uncomfortable" :
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
  return d >= 2.0   ? "#3c0501ff" :
         d >= 1.25  ? "#db1e14ff" :  
         d >= 0.8   ?  "#e6733dff" :  
         d >= 0.5   ? "#f9bc12ff" :  
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

window.addEventListener("load", () => {
  const checkReady = setInterval(() => {
    if (streetsLoaded) {
      clearInterval(checkReady);
      loadPreset("maxvorstadt");
    }
  }, 100); // check every 100ms
});








