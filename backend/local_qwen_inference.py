from openai import OpenAI

client = OpenAI(
    base_url="https://qsfq3pz2-11434.euw.devtunnels.ms/v1",
    api_key="local-testing"
)

# Enable streaming to keep the dev tunnel alive
response = client.chat.completions.create(
    model="qwen3.6:35b",
    messages=[
        {"role": "system", "content": "You are a technical mentor."},
        {"role": "user", "content": "Confirm connection: Are you running on the remote GPU machine?"}
    ],
    stream=True # This forces the immediate return of data
)

# Print the chunks to the console in real-time
for chunk in response:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="", flush=True)