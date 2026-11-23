import { Flight } from '../model/flight.model';

export type FlightProps = {
  outbound: Flight, 
  inbound: Flight
}

export type RecommendedFlights = {
  outbound: Flight,
  inbound: Flight
}

// Flight times are stored in UTC: show the same date the itinerary text uses.
export function flightDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

export function priceWithCommas(price: number) {
  if (!price) {
    return '-';
  }
  return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const Flights = (props: FlightProps) => {
  return (
    <div className="flights__summary__div">
      <p className="flights__emoji">✈️</p>
        <div className="flights__section">
          <h4>Outbound Flights</h4>
          { !props.outbound && <p>No outbound flights available</p> }
          { props.outbound && 
            <div className="flights__detail">
              <p>{props.outbound?.flight_number} on {flightDate(props.outbound?.departure_date)}: £{priceWithCommas(props.outbound?.price)}</p>
            </div> 
          }
          <h4>Inbound Flights</h4>
          { !props.inbound && <p>No return flights available</p> }
          {  props.inbound &&
            <div className="flights__detail">
              <p>{props.inbound?.flight_number} on {flightDate(props.inbound?.departure_date)}: £{priceWithCommas(props.inbound?.price)}</p>
            </div>
          }
        </div>
    </div>
  );
};