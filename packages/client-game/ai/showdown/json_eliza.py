import requests
import json
from showdown.websocket_client import PSWebsocketClient
from config import ShowdownConfig, init_logging

__all__ = ['send_to_eliza', 'prepare_battle_data']
# Configuración del servidor de Eliza
ELIZA_URL = "http://localhost:3000"
AGENT_ID = "2bfaa56d-f9bb-042c-a563-f9c5fcd293db"  # Reemplaza con el nombre del agente si no es "default"

def send_to_eliza(battle_data):
    """
    Envía el JSON del estado de la batalla a Eliza y devuelve la respuesta.
    """
    try:
        url = f"{ELIZA_URL}/{AGENT_ID}/message"
        headers = {'Content-Type': 'application/json'}
        payload = {
            "text": json.dumps(battle_data),  # El estado de la batalla como texto
            "userId": "user",
            "userName": "User"
        }
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()  # Levanta una excepción si ocurre un error
        return response.json()  # Decodifica la respuesta JSON de Eliza
    except requests.exceptions.RequestException as e:
        print(f"Error al comunicarse con Eliza: {e}")
        return None
    
def prepare_battle_data(battle_data):
    """
    Reduce el tamaño del JSON del estado de la batalla para cumplir con los límites del modelo.
    """
    simplified_data = {
        "turn": battle_data.get("turn"),
        "user_active": {
            "id": battle_data["user"]["active"]["id"],
            "hp": battle_data["user"]["active"]["hp"],
            "moves": battle_data["user"]["active"].get("moves", []),
        },
        "opponent_active": {
            "id": battle_data["opponent"]["active"]["id"],
            "hp": battle_data["opponent"]["active"]["hp"],
        },
    }
    return simplified_data

if __name__ == "__main__":
    # Leer el estado de la batalla desde un archivo JSON
    with open("battle_state.json", "r") as battle_file:
        battle_data = json.load(battle_file)

    simplified_battle_data = prepare_battle_data(battle_data)
    response = send_to_eliza(simplified_battle_data)
    if response:
        print("Respuesta de Eliza:", response)
    else:
        print("Error Eliza")


    # Mostrar la respuesta
    # Continuación del script
async def ElizaOuput(ps_websocket_client, eliza_response):
    # Crear cliente WebSocket si no está inicializado
    if not ps_websocket_client:
        ps_websocket_client = await PSWebsocketClient.create(
            ShowdownConfig.username,
            ShowdownConfig.password,
            ShowdownConfig.websocket_uri
        )
        await ps_websocket_client.login()

    # Enviar mensaje al chat del juego
    if eliza_response:
        eliza_text = eliza_response[0]['text']  # Extraer texto de la respuesta de Eliza
        print("Enviando al chat del juego:", eliza_text)
        await ps_websocket_client.send_message(eliza_text)  # Enviar el mensaje al servidor de Showdown
    else:
        print("No hay respuesta válida de Eliza para enviar.")
