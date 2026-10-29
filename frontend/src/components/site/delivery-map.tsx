"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import type { LatLngTuple } from "leaflet";

export type GeoPoint = { latitude: number; longitude: number };

const DEFAULT_CENTER: LatLngTuple = [6.9271, 79.8612];

function MapInteractions({
  onSelect,
  destination,
  rider,
}: {
  onSelect?: (point: GeoPoint) => void;
  destination: GeoPoint | null;
  rider: GeoPoint | null;
}) {
  const map = useMap();
  const destinationLatitude = destination?.latitude;
  const destinationLongitude = destination?.longitude;
  const riderLatitude = rider?.latitude;
  const riderLongitude = rider?.longitude;
  useMapEvents({
    click(event) {
      onSelect?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });

  useEffect(() => {
    if (destinationLatitude != null && destinationLongitude != null && riderLatitude != null && riderLongitude != null) {
      map.fitBounds(
        [
          [destinationLatitude, destinationLongitude],
          [riderLatitude, riderLongitude],
        ],
        { padding: [36, 36], maxZoom: 14 },
      );
    } else if (destinationLatitude != null && destinationLongitude != null) {
      map.setView([destinationLatitude, destinationLongitude], 14);
    }
  }, [map, destinationLatitude, destinationLongitude, riderLatitude, riderLongitude]);

  return null;
}

export function DeliveryMap({
  destination,
  rider = null,
  onSelect,
}: {
  destination: GeoPoint | null;
  rider?: GeoPoint | null;
  onSelect?: (point: GeoPoint) => void;
}) {
  const center: LatLngTuple = destination
    ? [destination.latitude, destination.longitude]
    : DEFAULT_CENTER;

  return (
    <div className="tf-delivery-map" aria-label="Delivery location map">
      <MapContainer center={center} zoom={destination ? 14 : 12} scrollWheelZoom zoomControl={false}>
        <ZoomControl position="topright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapInteractions onSelect={onSelect} destination={destination} rider={rider} />
        {destination && rider && <Polyline positions={[[rider.latitude, rider.longitude], [destination.latitude, destination.longitude]]} pathOptions={{ color: "#283322", weight: 5, opacity: 0.82, dashArray: "9 10", lineCap: "round" }} />}
        {destination && (
          <>
            <CircleMarker center={[destination.latitude, destination.longitude]} radius={17} interactive={false} pathOptions={{ color: "#9c7841", fillColor: "#ead8b1", fillOpacity: 0.42, weight: 1 }} />
            <CircleMarker center={[destination.latitude, destination.longitude]} radius={8} pathOptions={{ color: "#fff", fillColor: "#9b7135", fillOpacity: 1, weight: 3 }}><Popup>Delivery destination</Popup></CircleMarker>
          </>
        )}
        {rider && (
          <>
            <CircleMarker center={[rider.latitude, rider.longitude]} radius={17} interactive={false} pathOptions={{ color: "#34442d", fillColor: "#9cac88", fillOpacity: 0.35, weight: 1 }} />
            <CircleMarker center={[rider.latitude, rider.longitude]} radius={8} pathOptions={{ color: "#fff", fillColor: "#34442d", fillOpacity: 1, weight: 3 }}><Popup>Courier location</Popup></CircleMarker>
          </>
        )}
      </MapContainer>
      {onSelect ? <div className="tf-delivery-map__hint"><span aria-hidden="true">⌖</span> Tap the map to place your delivery pin</div> : <div className="tf-delivery-map__legend"><span><i className="destination" />Your address</span>{rider && <span><i className="courier" />Courier</span>}</div>}
    </div>
  );
}
