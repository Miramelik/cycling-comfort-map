const map = L.map('map').setView([48.1374, 11.5755], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

flatpickr("#startTime", { enableTime: true, dateFormat: "Y-m-d\\TH:i:S\\Z" });
flatpickr("#endTime", { enableTime: true, dateFormat: "Y-m-d\\TH:i:S\\Z" });

async function fetchObservations(id, start, end, includeLocation = false) {
    const startISO = new Date(start).toISOString();
    const endISO = new Date(end).toISOString();


    let url = `${CONFIG.baseUrl}/Datastreams(${id})/Observations?` +
          `$filter=during(phenomenonTime,${startISO}/${endISO})` +
          `&$orderby=phenomenonTime&$top=1000`;

if (includeLocation) url += `&$expand=FeatureOfInterest`

  const res = await fetch(url);
   if (!res.ok) throw new Error(`Fetch failed for Datastream ${id}`);

  const data = await res.json();
  return data.value;
}

async function loadData() {
  const start = document.getElementById('startTime').value;
  const end = document.getElementById('endTime').value;
  const colorBy = document.getElementById('colorBy').value;

  if (!start || !end) {
    alert("Please select start and end times.");
    return;
  }

  map.eachLayer(layer => {
    if (layer instanceof L.CircleMarker) map.removeLayer(layer);
  });

  const [gpsData, rmsData, cciData, speedData] = await Promise.all([
    fetchObservations(CONFIG.datastreams.gps, start, end, true),
    fetchObservations(CONFIG.datastreams.rms, start, end),
    fetchObservations(CONFIG.datastreams.cci, start, end),
    fetchObservations(CONFIG.datastreams.speed, start, end),
  ]);

  const joined = gpsData.map(gps => {
    const t = gps.phenomenonTime;
    const coord = [
        gps.result.longitude,
        gps.result.latitude
    ];


    return {
      time: t,
      lat: coord[1],
      lon: coord[0],
      rms: rmsData.find(d => d.phenomenonTime === t)?.result,
      cci: cciData.find(d => d.phenomenonTime === t)?.result,
      speed: speedData.find(d => d.phenomenonTime === t)?.result
    };
  });

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
        radius: 6,
        color: color,
        fillOpacity: 0.7
      }).addTo(map).bindPopup(popup);
    }
  });
  updateLegend(colorBy);
  //updateLegend("rms"); 

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
      grades = [0.0, 0.05, 0.2, 0.6, 1.0];
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
        let description = "";

  if (metric.toLowerCase() === "rms") {
    const to = grades[i + 1];
    description = to ? `${g}–${to}` : `${g}+`;
  } else if (metric.toLowerCase() === "cci") {
    description =
      g === 5 ? "Very comfortable" :
      g === 4 ? "Comfortable" :
      g === 3 ? "Slightly uncomfortable" :
      g === 2 ? "Uncomfortable" :
                "Extremely uncomfortable";
  }

  div.innerHTML +=
    `<i style="background:${getColor(g)}"></i> ${description}<br>`;
}

    return div;
  };

  legendControl.addTo(map);
}

function getColorForRMS(d) {
  return d >= 1.0   ? "#caf0f8" :  
         d >= 0.6   ? "#90e0ef" :  
         d >= 0.2   ? "#00b4d8" :  
         d >= 0.05  ? "#0077b6" :  
                      "#03045e";   
}

function getColorForCCI(d) {
  return d === 5 ? "#216e39" :  // very comfortable - dark green
         d === 4 ? "#4daf4a" :  // comfortable - green
         d === 3 ? "#fee08b" :  // slightly uncomfortable - yellow
         d === 2 ? "#fc8d59" :  // uncomfortable - orange
                   "#d73027";   // extremely uncomfortable - red
}

document.getElementById("colorBy").addEventListener("change", function () {
  const selected = this.value;
  updateLegend(selected);
});

// initialize legend based on default dropdown value
updateLegend(document.getElementById("colorBy").value);





