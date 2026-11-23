export type WeatherProps = {
  location: string;
  condition: string;
  condition_emoji: string;
  temperature: number;
  feels_like_temperature: number;
  humidity: number;
};

export const Weather = (props: WeatherProps) => {
  return (
    <div className="weather__summary__container">
      <h3>{props.location}</h3>
      <div className="weather__temp__condition">
        <p className="temperature__p">{props.temperature}°C</p>
        <p className="weather__emoji" title={props.condition} aria-label={props.condition}>
          {props.condition_emoji}
        </p>
      </div>
      <p className="feels__like__p">Feels like {props.feels_like_temperature}°C</p>
      <p>Humidity {props.humidity}%</p>
    </div>
  );
};
